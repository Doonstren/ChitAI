# backend/core/llm.py
"""
Multi-model LLM client with automatic fallback and thinking/reasoning support.

Model priority:
  1. gemini-3.5-flash   – primary, supports ``thinking_config``
  2. gemma-4-31b        – secondary
  3. gemini-3.1-flash-lite – lightweight fallback

Uses the ``google-genai`` SDK (``google.genai``).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

# ── Thinking-capable models ─────────────────────────────────────────────
_THINKING_MODELS = frozenset({"gemini-3.5-flash", "gemini-3.5-pro"})


@dataclass
class _ModelUsage:
    """Track per-model request counters for RPM / RPD enforcement."""

    rpm_timestamps: list[float] = field(default_factory=list)
    rpd_count: int = 0
    rpd_reset_day: float = 0.0  # start-of-day timestamp


class GeminiLLM:
    """
    LLM wrapper with ordered model fallback and usage tracking.

    When a model call fails (quota, server error, etc.), the next model
    in the priority list is tried automatically.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._client = genai.Client(api_key=self._settings.GEMINI_API_KEY)
        self._models: List[str] = list(self._settings.LLM_MODELS)
        self._rpm_limit = self._settings.LLM_RPM_LIMIT
        self._rpd_limit = self._settings.LLM_RPD_LIMIT

        # Per-model usage counters
        self._usage: Dict[str, _ModelUsage] = {
            m: _ModelUsage() for m in self._models
        }

    # ── Public API ──────────────────────────────────────────────────────

    def generate(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: int = 8192,
    ) -> str:
        """
        Generate a text completion, falling back through models on failure.

        Args:
            prompt: The user / RAG prompt.
            system_prompt: Optional system instruction.
            temperature: Sampling temperature (0.0–2.0).
            max_output_tokens: Maximum tokens in the response.

        Returns:
            The generated text.

        Raises:
            RuntimeError: If all models fail.
        """
        errors: list[str] = []

        for model_name in self._models:
            try:
                self._wait_for_rate_limit(model_name)
                config = self._build_config(
                    model_name,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                )

                response = self._client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=config,
                )

                self._record_request(model_name)
                text = self._extract_text(response)
                logger.info(
                    "LLM response from %s (%d chars)", model_name, len(text)
                )
                return text

            except Exception as exc:
                logger.warning(
                    "Model %s failed: %s – falling back", model_name, exc
                )
                errors.append(f"{model_name}: {exc}")

        raise RuntimeError(
            "Усі LLM-моделі недоступні:\n" + "\n".join(errors)
        )

    def generate_json(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_output_tokens: int = 8192,
    ) -> Dict[str, Any]:
        """
        Generate a response and parse it as JSON.

        Instructs the model to output valid JSON and strips markdown
        fences if present.

        Args:
            prompt: The user / RAG prompt.
            system_prompt: Optional system instruction.
            temperature: Lower default for deterministic output.
            max_output_tokens: Maximum tokens in the response.

        Returns:
            Parsed JSON dict.

        Raises:
            RuntimeError: If all models fail.
            json.JSONDecodeError: If the output is not valid JSON.
        """
        errors: list[str] = []

        for model_name in self._models:
            try:
                self._wait_for_rate_limit(model_name)
                config = self._build_config(
                    model_name,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    json_mode=True,
                )

                contents = prompt
                # Prepend system prompt as part of contents if provided
                if system_prompt:
                    contents = f"{system_prompt}\n\n{prompt}"

                response = self._client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )

                self._record_request(model_name)
                raw = self._extract_text(response)
                parsed = self._parse_json(raw)
                logger.info("JSON response from %s", model_name)
                return parsed

            except json.JSONDecodeError as exc:
                logger.warning(
                    "Model %s returned invalid JSON: %s", model_name, exc
                )
                errors.append(f"{model_name}: invalid JSON – {exc}")
            except Exception as exc:
                logger.warning(
                    "Model %s failed: %s – falling back", model_name, exc
                )
                errors.append(f"{model_name}: {exc}")

        raise RuntimeError(
            "Усі LLM-моделі недоступні або повернули невалідний JSON:\n"
            + "\n".join(errors)
        )

    # ── Async variants ──────────────────────────────────────────────────

    async def agenerate(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: int = 8192,
    ) -> str:
        """Async wrapper around :meth:`generate`."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.generate(
                prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ),
        )

    async def agenerate_json(
        self,
        prompt: str,
        *,
        system_prompt: Optional[str] = None,
        temperature: float = 0.3,
        max_output_tokens: int = 8192,
    ) -> Dict[str, Any]:
        """Async wrapper around :meth:`generate_json`."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.generate_json(
                prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ),
        )

    # ── Config builder ──────────────────────────────────────────────────

    def _build_config(
        self,
        model_name: str,
        *,
        temperature: float,
        max_output_tokens: int,
        json_mode: bool = False,
    ) -> types.GenerateContentConfig:
        """
        Build a ``GenerateContentConfig`` appropriate for *model_name*.

        Enables ``thinking`` for capable models (gemini-3.5-*).
        """
        kwargs: Dict[str, Any] = {
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        }

        # Enable thinking/reasoning for supported models
        if model_name in _THINKING_MODELS:
            kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_budget=2048,
            )

        # Request JSON output
        if json_mode:
            kwargs["response_mime_type"] = "application/json"

        return types.GenerateContentConfig(**kwargs)

    # ── Response helpers ────────────────────────────────────────────────

    @staticmethod
    def _extract_text(response: Any) -> str:
        """Pull the generated text from a Gemini response object."""
        # response.text is a convenience property on the SDK response
        if hasattr(response, "text") and response.text:
            return response.text

        # Fallback: iterate through candidates → parts
        for candidate in getattr(response, "candidates", []):
            for part in getattr(candidate, "content", {}).get("parts", []):
                if "text" in part:
                    return part["text"]

        return ""

    @staticmethod
    def _parse_json(raw: str) -> Dict[str, Any]:
        """
        Parse *raw* as JSON, stripping optional markdown fences.

        Models sometimes wrap JSON in ```json ... ```.
        """
        text = raw.strip()

        # Strip markdown code fences
        if text.startswith("```"):
            # Remove leading ```json or ``` and trailing ```
            lines = text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)

        return json.loads(text)

    # ── Rate-limit helpers ──────────────────────────────────────────────

    def _wait_for_rate_limit(self, model_name: str) -> None:
        """Block until we are within RPM / RPD limits for *model_name*."""
        usage = self._usage[model_name]
        now = time.monotonic()
        window = 60.0

        # ── RPM check ──────────────────────────────────────────────────
        usage.rpm_timestamps = [
            ts for ts in usage.rpm_timestamps if now - ts < window
        ]
        if len(usage.rpm_timestamps) >= self._rpm_limit:
            sleep_for = window - (now - usage.rpm_timestamps[0]) + 0.1
            logger.warning(
                "LLM RPM limit (%d) reached for %s – sleeping %.1fs",
                self._rpm_limit,
                model_name,
                sleep_for,
            )
            time.sleep(sleep_for)

        # ── RPD check (simple daily counter reset every 24h) ───────────
        day_start = now - (now % 86400)
        if usage.rpd_reset_day < day_start:
            usage.rpd_count = 0
            usage.rpd_reset_day = day_start

        if usage.rpd_count >= self._rpd_limit:
            logger.error(
                "LLM RPD limit (%d) reached for %s – skipping model",
                self._rpd_limit,
                model_name,
            )
            raise RuntimeError(f"Daily limit reached for {model_name}")

    def _record_request(self, model_name: str) -> None:
        """Record a successful request for rate-limit tracking."""
        usage = self._usage[model_name]
        usage.rpm_timestamps.append(time.monotonic())
        usage.rpd_count += 1


# ── Module-level convenience (lazy singleton) ───────────────────────────

_default_llm: Optional[GeminiLLM] = None


def get_llm(settings: Optional[Settings] = None) -> GeminiLLM:
    """Return a module-level singleton LLM instance."""
    global _default_llm
    if _default_llm is None:
        _default_llm = GeminiLLM(settings)
    return _default_llm
