# backend/core/config.py
"""
Application settings loaded from environment variables / .env file.

Uses pydantic-settings so every value can be overridden via env vars.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the ЧитAI backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Google AI ───────────────────────────────────────────────────────
    GEMINI_API_KEY: str

    # ── Firebase ────────────────────────────────────────────────────────
    FIREBASE_SERVICE_ACCOUNT_PATH: str = "./firebase-service-account.json"

    # ── Admin access (protected endpoints, e.g. POST /api/books/ingest) ──
    # Comma-separated lists. If BOTH are empty, the ingest endpoint is fully
    # locked (local ingest_folder.py still works — it bypasses the API).
    ADMIN_EMAILS: Annotated[List[str], NoDecode] = []
    ADMIN_UIDS: Annotated[List[str], NoDecode] = []

    # ── Server ──────────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    # NoDecode: parse comma-separated env values via the validator below
    # instead of pydantic-settings' default JSON decoding (which would crash
    # on a plain "a,b" string).
    CORS_ORIGINS: Annotated[List[str], NoDecode] = [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ]

    # ── Local NumPy vector DB ───────────────────────────────────────────
    NUMPY_DB_PATH: str = "./data/numpy"
    # Backward compatibility for old local .env files. Prefer NUMPY_DB_PATH.
    CHROMA_DB_PATH: Optional[str] = None

    # ── RAG parameters ──────────────────────────────────────────────────
    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 150
    TOP_K_RESULTS: int = 5
    BOOK_PROFILE_RESULTS: int = 5
    CHUNKS_PER_PROFILE_BOOK: int = 2

    # ── LLM model priority (comma-separated string in .env) ────────────
    LLM_MODELS: Annotated[List[str], NoDecode] = [
        "gemini-3.5-flash",
        "gemma-4-31b-it",
        "gemini-3.1-flash-lite",
    ]

    # Model used specifically for short chat-thread titles ("always Gemma").
    TITLE_MODEL: str = "gemma-4-31b-it"

    # ── Embedding model ─────────────────────────────────────────────────
    EMBEDDING_MODEL: str = "qwen3-embedding:4b-q4_K_M"
    EMBEDDING_DIMENSIONS: int = 1024
    
    # ── Ollama ──────────────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = "http://192.168.50.106:11434"

    # ── Rate-limit defaults (requests per minute) ───────────────────────
    LLM_RPM_LIMIT: int = 15
    LLM_RPD_LIMIT: int = 1500

    # ── Validators ──────────────────────────────────────────────────────
    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors(cls, v: str | List[str]) -> List[str]:
        """Accept both a comma-separated string and a Python list."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("LLM_MODELS", mode="before")
    @classmethod
    def _parse_llm_models(cls, v: str | List[str]) -> List[str]:
        """Accept both a comma-separated string and a Python list."""
        if isinstance(v, str):
            return [m.strip() for m in v.split(",") if m.strip()]
        return v

    @field_validator("ADMIN_EMAILS", "ADMIN_UIDS", mode="before")
    @classmethod
    def _parse_admin_list(cls, v: str | List[str]) -> List[str]:
        """Accept both a comma-separated string and a Python list."""
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @property
    def numpy_db_abs_path(self) -> Path:
        """Return an absolute, resolved path to the local vector DB directory."""
        return Path(self.NUMPY_DB_PATH).resolve()

    @property
    def chroma_db_abs_path(self) -> Path:
        """Deprecated alias kept so older helper scripts do not break immediately."""
        return self.numpy_db_abs_path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return a cached singleton of the application settings.

    Call this instead of instantiating ``Settings()`` directly so that
    the .env file is only read once per process.
    """
    return Settings()  # type: ignore[call-arg]
