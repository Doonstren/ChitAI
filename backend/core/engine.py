# backend/core/engine.py
"""
RAG orchestrator for the ЧитAI platform.

Ties together:  embeddings → retriever → prompt builder → LLM
Exposes two high-level methods:
  - ``chat()``          – full conversational RAG pipeline
  - ``search_books()``  – catalog search returning structured results
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .config import Settings, get_settings
from .embeddings import OllamaEmbedder, get_embedder
from .llm import GeminiLLM, get_llm
from .prompts import SYSTEM_PROMPT, build_rag_prompt, build_search_prompt
from .retriever import DOC_TYPE_BOOK_CHUNK, DOC_TYPE_BOOK_PROFILE, Retriever, get_retriever

logger = logging.getLogger(__name__)


@dataclass
class ChatResponse:
    """Structured response from the RAG chat pipeline."""

    answer: str
    books: List[Dict[str, Any]] = field(default_factory=list)
    raw_json: Optional[Dict[str, Any]] = None
    model_used: Optional[str] = None
    chunks_retrieved: int = 0


class RAGEngine:
    """
    High-level RAG orchestrator.

    Usage::

        engine = RAGEngine()
        response = engine.chat("Порадь книгу про космос")
        print(response.answer)
        for book in response.books:
            print(book["title"], book["relevance_score"])
    """

    def __init__(
        self,
        *,
        settings: Optional[Settings] = None,
        embedder: Optional[OllamaEmbedder] = None,
        llm: Optional[GeminiLLM] = None,
        retriever: Optional[Retriever] = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._embedder = embedder or get_embedder(self._settings)
        self._llm = llm or get_llm(self._settings)
        self._retriever = retriever or get_retriever(self._settings)

    @staticmethod
    def _meta_title(meta: Dict[str, Any]) -> str:
        return meta.get("book_title") or meta.get("title") or "—"

    @staticmethod
    def _meta_author(meta: Dict[str, Any]) -> str:
        return meta.get("book_author") or meta.get("author") or "—"

    @staticmethod
    def _book_card_from_chunk(chunk: Dict[str, Any]) -> Dict[str, Any]:
        meta = chunk.get("metadata", {})
        return {
            "title": RAGEngine._meta_title(meta),
            "author": RAGEngine._meta_author(meta),
            "description": meta.get("description") or chunk.get("text", "")[:220],
            "book_id": meta.get("book_id", ""),
            "relevance_score": round(1.0 - chunk.get("distance", 1.0), 2),
        }

    def _enrich_books(self, books: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        enriched = []
        seen_book_ids = set()

        for book in books:
            book_id = book.get("book_id", "")
            if book_id in seen_book_ids:
                continue
            if book_id:
                seen_book_ids.add(book_id)

            meta = self._retriever.get_book(book_id) if book_id else None
            merged = dict(book)
            if meta:
                merged["title"] = meta.get("title", merged.get("title", ""))
                merged["author"] = meta.get("author", merged.get("author", ""))
                merged["genres"] = meta.get("genres", [])
                merged["genre"] = meta.get("genre", "")
                merged["tags"] = meta.get("tags", [])
                merged["language"] = meta.get("language", "")
                merged["series"] = meta.get("series", "")
                merged["series_number"] = meta.get("series_number", "")
                merged["publication_year"] = meta.get("publication_year", "")
                merged["publication_date"] = meta.get("publication_date") or meta.get("publication_year", "")
                merged["cover_url"] = meta.get("cover_url", "")
                merged["license"] = meta.get("license", "")
                merged["rights_status"] = meta.get("rights_status", "")
                merged["source_url"] = meta.get("source_url", "")
            enriched.append(merged)

        return enriched

    def _retrieve_dual_tier_context(
        self,
        query_embedding: List[float],
        *,
        filters: Optional[Dict[str, Any]] = None,
        k: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        target_k = k or self._settings.TOP_K_RESULTS
        focused_book = bool(filters and filters.get("book_id"))

        if focused_book:
            return self._retriever.search(
                query_embedding,
                k=target_k,
                filters=filters,
                doc_type=DOC_TYPE_BOOK_CHUNK,
            )

        profiles = self._retriever.search(
            query_embedding,
            k=max(target_k, self._settings.BOOK_PROFILE_RESULTS),
            filters=filters,
            doc_type=DOC_TYPE_BOOK_PROFILE,
            diverse=True,
            relevance_threshold_drop=0.12,
        )

        if not profiles:
            return self._retriever.search(
                query_embedding,
                k=target_k,
                filters=filters,
                doc_type=DOC_TYPE_BOOK_CHUNK,
            )

        book_ids = []
        for profile in profiles:
            book_id = profile.get("metadata", {}).get("book_id")
            if book_id and book_id not in book_ids:
                book_ids.append(book_id)

        chunk_filters = dict(filters or {})
        chunk_filters["book_id"] = book_ids
        chunks = self._retriever.search(
            query_embedding,
            k=max(target_k, len(book_ids) * self._settings.CHUNKS_PER_PROFILE_BOOK),
            filters=chunk_filters,
            doc_type=DOC_TYPE_BOOK_CHUNK,
            diverse=True,
            relevance_threshold_drop=0.15,
        )

        return profiles + chunks

    # ── Chat (full RAG pipeline) ────────────────────────────────────────

    def chat(
        self,
        user_message: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        k: Optional[int] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> ChatResponse:
        """
        Run the full RAG pipeline for a user message.

        Steps:
            1. Embed the user query.
            2. Retrieve relevant book profiles, then matching text chunks.
            3. Build the RAG prompt with context.
            4. Send to the LLM and parse the JSON response.

        Args:
            user_message: The user's natural-language query.
            filters: Optional NumPy DB metadata filters.
            k: Number of chunks to retrieve (defaults to config).

        Returns:
            A :class:`ChatResponse` with the answer and book list.
        """
        logger.info("RAG chat – query: %.80s…", user_message)

        # 1. Embed the query
        query_embedding = self._embedder.embed_query(user_message)

        # 2. Retrieve relevant book profiles and supporting chunks
        chunks = self._retrieve_dual_tier_context(
            query_embedding, k=k, filters=filters
        )
        logger.info("Retrieved %d context items", len(chunks))

        # 3. Build the full prompt (with optional conversation history)
        rag_prompt = build_rag_prompt(user_message, chunks, history=history)

        # 4. Generate via LLM (JSON mode)
        try:
            result = self._llm.generate_json(
                rag_prompt,
                system_prompt=SYSTEM_PROMPT,
                temperature=0.4,
            )
        except Exception as exc:
            logger.error("LLM generation failed: %s", exc)
            return ChatResponse(
                answer=(
                    "Вибачте, наразі я не можу обробити ваш запит. "
                    "Спробуйте пізніше або переформулюйте питання."
                ),
                chunks_retrieved=len(chunks),
            )

        return ChatResponse(
            answer=result.get("answer", ""),
            books=self._enrich_books(result.get("books", [])),
            raw_json=result,
            chunks_retrieved=len(chunks),
        )

    # ── Catalog search ──────────────────────────────────────────────────

    def search_books(
        self,
        query: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        k: Optional[int] = None,
    ) -> ChatResponse:
        """
        Search the book catalog and return LLM-summarised results.

        Similar to :meth:`chat` but uses a simpler search-oriented prompt.

        Args:
            query: Search query (title, author, genre keywords, etc.).
            filters: Optional NumPy DB metadata filters.
            k: Number of chunks to retrieve.

        Returns:
            A :class:`ChatResponse` with search results.
        """
        logger.info("Catalog search – query: %.80s…", query)

        query_embedding = self._embedder.embed_query(query)
        chunks = self._retriever.search(
            query_embedding,
            k=k,
            filters=filters,
            doc_type=DOC_TYPE_BOOK_PROFILE,
            diverse=True,
            relevance_threshold_drop=0.12,
        )
        if not chunks:
            chunks = self._retriever.search(
                query_embedding,
                k=k,
                filters=filters,
                doc_type=DOC_TYPE_BOOK_CHUNK,
                diverse=True,
            )

        search_prompt = build_search_prompt(query, chunks)

        try:
            result = self._llm.generate_json(
                search_prompt,
                system_prompt=SYSTEM_PROMPT,
                temperature=0.3,
            )
        except Exception as exc:
            logger.error("Search LLM generation failed: %s", exc)
            # Fallback: return raw chunk data without LLM summary
            fallback_books = []
            seen_book_ids = set()
            for chunk in chunks:
                meta = chunk.get("metadata", {})
                book_id = meta.get("book_id", "")
                if book_id in seen_book_ids:
                    continue
                seen_book_ids.add(book_id)
                fallback_books.append(self._book_card_from_chunk(chunk))
            return ChatResponse(
                answer="Ось що вдалося знайти у каталозі:",
                books=fallback_books,
                chunks_retrieved=len(chunks),
            )

        return ChatResponse(
            answer=result.get("answer", ""),
            books=self._enrich_books(result.get("books", [])),
            raw_json=result,
            chunks_retrieved=len(chunks),
        )

    # ── Chat-thread title ───────────────────────────────────────────────

    def make_title(self, user_message: str) -> str:
        """Generate a short chat-thread title via the Gemma model."""
        return self._llm.generate_title(user_message)

    # ── Async variants ──────────────────────────────────────────────────

    async def achat(
        self,
        user_message: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        k: Optional[int] = None,
    ) -> ChatResponse:
        """Async version of :meth:`chat`."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.chat(user_message, filters=filters, k=k),
        )

    async def asearch_books(
        self,
        query: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        k: Optional[int] = None,
    ) -> ChatResponse:
        """Async version of :meth:`search_books`."""
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.search_books(query, filters=filters, k=k),
        )

    # ── Direct document indexing (convenience) ──────────────────────────

    def index_chunks(
        self,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """
        Embed and index a batch of text chunks into the NumPy DB.

        Each chunk dict must contain ``id``, ``text``, and ``metadata``.
        Embeddings are computed automatically.

        Args:
            chunks: List of chunk dicts.

        Returns:
            Number of chunks indexed.
        """
        if not chunks:
            return 0

        texts = [c["text"] for c in chunks]
        embeddings = self._embedder.embed_texts(texts)

        enriched = []
        for chunk, embedding in zip(chunks, embeddings):
            enriched.append(
                {
                    "id": chunk["id"],
                    "text": chunk["text"],
                    "embedding": embedding,
                    "metadata": chunk.get("metadata", {}),
                }
            )

        return self._retriever.add_documents(enriched)

    def delete_book(self, book_id: str) -> int:
        """Remove all indexed chunks for a book."""
        return self._retriever.delete_book(book_id)

    @property
    def collection_count(self) -> int:
        """Total number of indexed chunks."""
        return self._retriever.count


# ── Module-level convenience (lazy singleton) ───────────────────────────

_default_engine: Optional[RAGEngine] = None


def get_engine(settings: Optional[Settings] = None) -> RAGEngine:
    """Return a module-level singleton RAG engine instance."""
    global _default_engine
    if _default_engine is None:
        _default_engine = RAGEngine(settings=settings)
    return _default_engine
