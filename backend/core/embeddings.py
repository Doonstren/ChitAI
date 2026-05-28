# backend/core/embeddings.py
"""
Ollama Embedding client.

Calls a local or remote Ollama server to generate embeddings.
Replaces the Gemini rate-limited client for unlimited local embedding generation.
"""

from __future__ import annotations

import asyncio
import logging
import requests
from typing import List, Optional

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

# Reduce batch size for local GPU VRAM safety (adjust based on your 1060 6GB)
_MAX_BATCH_SIZE = 10


class OllamaEmbedder:
    """Thin wrapper around the Ollama embedding API."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._base_url = self._settings.OLLAMA_BASE_URL.rstrip('/')
        self._model = self._settings.EMBEDDING_MODEL
        self._dimensions = getattr(self._settings, 'EMBEDDING_DIMENSIONS', 1024)

    # ── Public API ──────────────────────────────────────────────────────

    def embed_texts(
        self,
        texts: List[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",
    ) -> List[List[float]]:
        """
        Embed a list of texts using local Ollama API.

        Args:
            texts: Texts to embed.
            task_type: Ignored for Ollama.

        Returns:
            A list of embedding vectors (one per input text).
        """
        if not texts:
            return []

        all_embeddings: list[list[float]] = []
        endpoint = f"{self._base_url}/api/embed"

        for start in range(0, len(texts), _MAX_BATCH_SIZE):
            batch = texts[start : start + _MAX_BATCH_SIZE]
            
            logger.debug(
                "Embedding batch %d–%d / %d (model=%s)",
                start,
                start + len(batch) - 1,
                len(texts),
                self._model,
            )

            payload = {
                "model": self._model,
                "input": batch,
                # Note: 'dimensions' parameter is supported in newer Ollama versions
                # specifically for mxbai and some other projection-capable models.
            }
            if self._dimensions:
                payload["truncate"] = False  # just in case
            
            try:
                response = requests.post(endpoint, json=payload, timeout=600)
                response.raise_for_status()
                data = response.json()
                
                # Ollama returns {"model": "...", "embeddings": [[...], [...]]}
                batch_embs = data.get("embeddings", [])
                
                # If dimensions feature is supported and needed, you might truncate manually
                # if the model doesn't support the 'dimensions' argument out of the box.
                # Qwen3-Embedding returns 1024-dim natively.
                
                all_embeddings.extend(batch_embs)
            except Exception as e:
                logger.error("Ollama API error: %s", e)
                # If it fails, raise or return what we have? Let's raise to stop bad ingestion
                raise RuntimeError(f"Ollama embedding failed: {e}")

        return all_embeddings

    def embed_query(self, text: str) -> List[float]:
        """
        Embed a single query text.
        """
        vectors = self.embed_texts([text])
        return vectors[0]

    # ── Async variants (for FastAPI async endpoints) ────────────────────

    async def aembed_texts(
        self,
        texts: List[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",
    ) -> List[List[float]]:
        """Async version of :meth:`embed_texts` (runs in a thread pool)."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, lambda: self.embed_texts(texts, task_type=task_type)
        )

    async def aembed_query(self, text: str) -> List[float]:
        """Async version of :meth:`embed_query`."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.embed_query, text)


# ── Module-level convenience (lazy singleton) ───────────────────────────

_default_embedder: Optional[OllamaEmbedder] = None

def get_embedder(settings: Optional[Settings] = None) -> OllamaEmbedder:
    """Return a module-level singleton embedder instance."""
    global _default_embedder
    if _default_embedder is None:
        _default_embedder = OllamaEmbedder(settings)
    return _default_embedder

EmbeddingClient = OllamaEmbedder
