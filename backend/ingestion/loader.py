"""
Full book ingestion pipeline.

Orchestrates parsing, chunking, profile generation, embedding, and storage
of book files into the local NumPy vector DB via the project's core services.
"""

import json
import logging
import re
import sys
import os
import uuid
from pathlib import Path
from typing import Any

# Ensure the backend package root is importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.config import get_settings
from core.embeddings import OllamaEmbedder as EmbeddingClient, get_embedder
from core.retriever import Retriever, get_retriever

from ingestion.parser import BookDocument, parse_book, SUPPORTED_EXTENSIONS
from ingestion.chunker import Chunk, chunk_text

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(text: str) -> str:
    """Create a URL/ID-friendly slug from *text*.

    Transliterates common Cyrillic characters, lowercases, strips
    non-alphanumeric characters, and collapses whitespace into hyphens.
    """

    # Basic Cyrillic → Latin transliteration map (covers Ukrainian & Russian).
    _TRANSLIT: dict[str, str] = {
        "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d",
        "е": "e", "є": "ye", "ж": "zh", "з": "z", "и": "y", "і": "i",
        "ї": "yi", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
        "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
        "ь": "", "ю": "yu", "я": "ya", "ё": "yo", "э": "e", "ы": "y",
        "ъ": "",
    }

    text = text.lower()
    transliterated = "".join(_TRANSLIT.get(ch, ch) for ch in text)
    slug = re.sub(r"[^a-z0-9]+", "-", transliterated).strip("-")
    return slug or f"book-{uuid.uuid4().hex[:8]}"


def _as_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


_FB2_GENRE_MAP: dict[str, dict[str, list[str]]] = {
    "sf": {"genres": ["Наукова фантастика"], "tags": []},
    "sf_cyberpunk": {"genres": ["Наукова фантастика"], "tags": ["кіберпанк"]},
    "sf_horror": {"genres": ["Жахи", "Наукова фантастика"], "tags": []},
    "humor_prose": {"genres": ["Гумор"], "tags": []},
    "literature_20": {"genres": ["Література XX століття"], "tags": []},
    "prose_contemporary": {"genres": ["Сучасна проза"], "tags": []},
    "romance_sf": {"genres": ["Наукова фантастика"], "tags": []},
}


def _load_sidecar_metadata(filepath: Path) -> dict[str, Any]:
    candidates = [
        filepath.with_suffix(".metadata.json"),
        Path(str(filepath) + ".metadata.json"),
    ]

    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            return json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Could not read metadata sidecar %s: %s", candidate, exc)
    return {}


def _normalize_book_metadata(doc: BookDocument, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = dict(doc.metadata or {})
    raw.update({k: v for k, v in (overrides or {}).items() if v not in (None, "", [])})

    raw_genre = str(raw.get("genre", "") or "").strip()
    mapped = _FB2_GENRE_MAP.get(raw_genre, {"genres": [], "tags": []})

    genres = _as_list(raw.get("genres")) or list(mapped["genres"])
    tags = _as_list(raw.get("tags")) + [tag for tag in mapped["tags"] if tag not in _as_list(raw.get("tags"))]

    title = str(raw.get("title") or doc.title).strip()
    author = str(raw.get("author") or doc.author).strip()

    metadata: dict[str, Any] = {
        "book_id": str(raw.get("book_id", "") or "").strip(),
        "title": title,
        "author": author,
        "book_title": title,
        "book_author": author,
        "description": str(raw.get("description", "") or "").strip(),
        "genre": raw_genre,
        "genres": genres,
        "tags": tags,
        "language": str(raw.get("language", "") or "").strip(),
        "series": str(raw.get("series", "") or "").strip(),
        "series_number": str(raw.get("series_number", "") or "").strip(),
        "aliases": _as_list(raw.get("aliases")),
        "publication_year": str(raw.get("publication_year", "") or "").strip(),
        "publication_date": str(raw.get("publication_date") or raw.get("publication_year", "") or "").strip(),
        "cover_url": str(raw.get("cover_url", "") or "").strip(),
        "license": str(raw.get("license", "") or "").strip(),
        "rights_status": str(raw.get("rights_status", "") or "").strip(),
        "source_url": str(raw.get("source_url", "") or "").strip(),
    }

    for key, value in raw.items():
        metadata.setdefault(key, value)

    return metadata


def _build_book_profile_text(metadata: dict[str, Any]) -> str:
    fields = [
        ("Назва", metadata.get("title")),
        ("Автор", metadata.get("author")),
        ("Серія", metadata.get("series")),
        ("Номер у серії", metadata.get("series_number")),
        ("Жанри", ", ".join(_as_list(metadata.get("genres")))),
        ("Теги", ", ".join(_as_list(metadata.get("tags")))),
        ("Мова", metadata.get("language")),
        ("Дата виходу", metadata.get("publication_date") or metadata.get("publication_year")),
        ("Альтернативні назви", ", ".join(_as_list(metadata.get("aliases")))),
        ("Опис", metadata.get("description")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in fields if value)


# ---------------------------------------------------------------------------
# BookLoader
# ---------------------------------------------------------------------------

class BookLoader:
    """End-to-end ingestion pipeline for book files.

    Parses a book file, builds a searchable book profile, splits the text
    into chunks, generates embeddings via :class:`EmbeddingClient`, and
    stores everything in the NumPy vector DB through the :class:`Retriever`.

    Args:
        embedding_batch_size: Maximum number of chunks to embed in a single
            API call (helps respect rate limits).
        chunk_size: Target chunk size in approximate tokens.
        chunk_overlap: Overlap between consecutive chunks in approximate tokens.
    """

    def __init__(
        self,
        embedding_batch_size: int = 50,
        chunk_size: int = 600,
        chunk_overlap: int = 100,
    ) -> None:
        settings = get_settings()
        self._embedder = get_embedder(settings)
        self._retriever = get_retriever(settings)
        self._batch_size = embedding_batch_size
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap

        logger.info(
            "BookLoader initialised (batch=%d, chunk_size=%d, overlap=%d)",
            self._batch_size, self._chunk_size, self._chunk_overlap,
        )

    # ------------------------------------------------------------------
    # Single book ingestion
    # ------------------------------------------------------------------

    def ingest_book(
        self,
        filepath: str | Path,
        book_id: str | None = None,
        metadata_overrides: dict[str, Any] | None = None,
    ) -> dict:
        """Parse, chunk, embed, and store a single book file.

        Args:
            filepath: Path to the book file.
            book_id: Optional explicit identifier. If *None*, one is
                generated from the book title via slugification.

        Returns:
            A dict with ingestion stats::

                {
                    "book_id": str,
                    "title": str,
                    "author": str,
                    "num_chunks": int,
                    "status": "success" | "error",
                    "error": str | None,
                }
        """

        filepath = Path(filepath)
        logger.info("▶ Starting ingestion: %s", filepath.name)

        # 1. Parse ----------------------------------------------------------
        doc: BookDocument = parse_book(filepath)
        sidecar_metadata = _load_sidecar_metadata(filepath)
        combined_overrides = {**sidecar_metadata, **(metadata_overrides or {})}
        book_metadata = _normalize_book_metadata(doc, combined_overrides)

        doc.title = book_metadata["title"]
        doc.author = book_metadata["author"]
        doc.metadata = {
            **doc.metadata,
            **{k: v for k, v in book_metadata.items() if k not in {"title", "author"}},
        }

        # 2. Generate book_id -----------------------------------------------
        if not book_id:
            book_id = book_metadata.get("book_id") or _slugify(doc.title)
        logger.info("  book_id = %s", book_id)

        # 3. Chunk -----------------------------------------------------------
        chunks: list[Chunk] = chunk_text(
            doc,
            book_id=book_id,
            chunk_size=self._chunk_size,
            chunk_overlap=self._chunk_overlap,
        )
        if not chunks:
            logger.warning("  No chunks produced — skipping embedding.")
            return {
                "book_id": book_id,
                "title": doc.title,
                "author": doc.author,
                "num_chunks": 0,
                "status": "success",
                "error": None,
            }

        logger.info("  Produced %d chunks", len(chunks))

        # 4. Embed (batched) ------------------------------------------------
        profile_text = _build_book_profile_text(book_metadata)
        all_texts = [profile_text] + [c.text for c in chunks]
        all_embeddings: list[list[float]] = []

        for batch_start in range(0, len(all_texts), self._batch_size):
            batch_end = batch_start + self._batch_size
            batch_texts = all_texts[batch_start:batch_end]
            logger.info(
                "  Embedding batch %d–%d / %d",
                batch_start, min(batch_end, len(all_texts)), len(all_texts),
            )
            batch_embeddings = self._embedder.embed_texts(
                batch_texts, task_type="RETRIEVAL_DOCUMENT",
            )
            all_embeddings.extend(batch_embeddings)

        # 5. Store in NumPy DB ----------------------------------------------
        ids = [f"{book_id}_profile"] + [f"{book_id}_chunk_{c.chunk_index}" for c in chunks]
        documents = all_texts
        profile_metadata = {
            **book_metadata,
            "book_id": book_id,
            "doc_type": "book_profile",
            "chunk_index": -1,
        }
        metadatas = [profile_metadata] + [
            {
                "book_id": c.book_id,
                "doc_type": "book_chunk",
                "title": c.book_title,
                "author": c.book_author,
                "book_title": c.book_title,
                "book_author": c.book_author,
                "chunk_index": c.chunk_index,
                "description": book_metadata.get("description", ""),
                "genres": book_metadata.get("genres", []),
                "tags": book_metadata.get("tags", []),
                "series": book_metadata.get("series", ""),
                "series_number": book_metadata.get("series_number", ""),
                "publication_year": book_metadata.get("publication_year", ""),
                "publication_date": book_metadata.get("publication_date", ""),
                "license": book_metadata.get("license", ""),
                "rights_status": book_metadata.get("rights_status", ""),
                "source_url": book_metadata.get("source_url", ""),
                **c.metadata,
            }
            for c in chunks
        ]

        self._retriever.add_documents(
            ids=ids,
            embeddings=all_embeddings,
            documents=documents,
            metadatas=metadatas,
        )

        total_stored = self._retriever.get_collection_count()
        logger.info(
            "  ✔ Stored %d chunks for '%s'. Collection total: %d",
            len(chunks), doc.title, total_stored,
        )

        return {
            "book_id": book_id,
            "title": doc.title,
            "author": doc.author,
            "description": book_metadata.get("description", ""),
            "genres": book_metadata.get("genres", []),
            "tags": book_metadata.get("tags", []),
            "series": book_metadata.get("series", ""),
            "publication_year": book_metadata.get("publication_year", ""),
            "publication_date": book_metadata.get("publication_date", ""),
            "license": book_metadata.get("license", ""),
            "rights_status": book_metadata.get("rights_status", ""),
            "source_url": book_metadata.get("source_url", ""),
            "num_chunks": len(chunks),
            "status": "success",
            "error": None,
        }

    # ------------------------------------------------------------------
    # Directory ingestion
    # ------------------------------------------------------------------

    def ingest_directory(self, dirpath: str | Path) -> list[dict]:
        """Ingest all supported book files in a directory.

        Processes every file with a supported extension
        (``{SUPPORTED_EXTENSIONS}``). Failures on individual books are
        logged and recorded but do **not** halt the overall run.

        Args:
            dirpath: Path to the directory containing book files.

        Returns:
            A list of per-book result dicts (see :meth:`ingest_book`).
        """

        dirpath = Path(dirpath)
        if not dirpath.is_dir():
            raise NotADirectoryError(f"Not a directory: {dirpath}")

        book_files = sorted(
            f for f in dirpath.iterdir()
            if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
        )

        if not book_files:
            logger.warning("No supported book files found in %s", dirpath)
            return []

        logger.info(
            "Found %d supported book file(s) in %s", len(book_files), dirpath,
        )

        results: list[dict] = []
        for idx, book_path in enumerate(book_files, start=1):
            logger.info("━" * 60)
            logger.info("[%d/%d] %s", idx, len(book_files), book_path.name)
            try:
                result = self.ingest_book(book_path)
            except Exception as exc:
                logger.error(
                    "Failed to ingest %s: %s", book_path.name, exc, exc_info=True,
                )
                result = {
                    "book_id": None,
                    "title": book_path.stem,
                    "author": "Unknown",
                    "num_chunks": 0,
                    "status": "error",
                    "error": str(exc),
                }
            results.append(result)

        # Summary
        ok = sum(1 for r in results if r["status"] == "success")
        fail = len(results) - ok
        logger.info("━" * 60)
        logger.info(
            "Ingestion complete: %d succeeded, %d failed out of %d total.",
            ok, fail, len(results),
        )

        return results
