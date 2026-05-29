# backend/core/retriever.py
"""
Simple Numpy-based retriever for the ЧитAI book platform.

Perfect for lightweight deployments (30-100 books).
Stores data in a JSON/Pickle file and uses exact cosine similarity search.
"""

from __future__ import annotations

import logging
import pickle
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

DOC_TYPE_BOOK_CHUNK = "book_chunk"
DOC_TYPE_BOOK_PROFILE = "book_profile"


class NumpyRetriever:
    """
    Lightweight vector database using NumPy.
    Saves state to a file locally.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        
        # Determine storage path. The setting name is kept for backwards
        # compatibility with existing .env files.
        storage_dir = Path(self._settings.numpy_db_abs_path)
        storage_dir.mkdir(parents=True, exist_ok=True)
        self._storage_file = storage_dir / "numpy_db.pkl"
        
        # In-memory storage
        self._chunks: List[Dict[str, Any]] = []
        self._embeddings_matrix: Optional[np.ndarray] = None
        self._normalized_embeddings_matrix: Optional[np.ndarray] = None
        
        self._load_from_disk()

    # ── Disk I/O ────────────────────────────────────────────────────────

    def _load_from_disk(self):
        if self._storage_file.exists():
            try:
                with open(self._storage_file, "rb") as f:
                    data = pickle.load(f)
                    self._chunks = data.get("chunks", [])
                    self._embeddings_matrix = data.get("embeddings", None)
                self._refresh_normalized_embeddings()
                logger.info("Loaded %d chunks from disk", len(self._chunks))
            except Exception as e:
                logger.error("Failed to load DB: %s", e)
                self._chunks = []
                self._embeddings_matrix = None
                self._normalized_embeddings_matrix = None
        else:
            logger.info("No existing DB found at %s. Starting fresh.", self._storage_file)

    def _refresh_normalized_embeddings(self) -> None:
        if self._embeddings_matrix is None:
            self._normalized_embeddings_matrix = None
            return

        norms = np.linalg.norm(self._embeddings_matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self._normalized_embeddings_matrix = self._embeddings_matrix / norms

    def _save_to_disk(self):
        try:
            with open(self._storage_file, "wb") as f:
                pickle.dump({
                    "chunks": self._chunks,
                    "embeddings": self._embeddings_matrix,
                }, f)
            logger.debug("Saved DB to disk")
        except Exception as e:
            logger.error("Failed to save DB: %s", e)

    # ── Indexing ────────────────────────────────────────────────────────

    def add_documents(
        self,
        chunks: Optional[List[Dict[str, Any]]] = None,
        *,
        ids: Optional[List[str]] = None,
        embeddings: Optional[List[List[float]]] = None,
        documents: Optional[List[str]] = None,
        metadatas: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        if chunks is not None:
            if not chunks:
                return 0
            ids = [c["id"] for c in chunks]
            documents = [c["text"] for c in chunks]
            embeddings = [c["embedding"] for c in chunks]
            metadatas = [c.get("metadata", {}) for c in chunks]
        else:
            if not ids or not embeddings or not documents:
                return 0
                
        # Append to our list
        for i in range(len(ids)):
            self._chunks.append({
                "id": ids[i],
                "text": documents[i],
                "document": documents[i],
                "metadata": metadatas[i] if metadatas else {},
            })
            
        # Update numpy matrix
        new_embs = np.array(embeddings, dtype=np.float32)
        if self._embeddings_matrix is None:
            self._embeddings_matrix = new_embs
        else:
            self._embeddings_matrix = np.vstack([self._embeddings_matrix, new_embs])
        self._refresh_normalized_embeddings()
            
        self._save_to_disk()
        logger.info("Added %d chunks to DB", len(ids))
        return len(ids)

    # ── Search ──────────────────────────────────────────────────────────

    @staticmethod
    def _metadata_value_matches(actual: Any, expected: Any) -> bool:
        if isinstance(expected, (list, tuple, set)):
            return any(NumpyRetriever._metadata_value_matches(actual, item) for item in expected)

        if isinstance(actual, (list, tuple, set)):
            return expected in actual

        return actual == expected

    @staticmethod
    def _chunk_doc_type(chunk: Dict[str, Any]) -> str:
        meta = chunk.get("metadata", {})
        return meta.get("doc_type") or DOC_TYPE_BOOK_CHUNK

    @classmethod
    def _metadata_matches(cls, chunk: Dict[str, Any], filters: Optional[Dict[str, Any]]) -> bool:
        if not filters:
            return True

        meta = chunk.get("metadata", {})
        for key, expected in filters.items():
            actual = cls._chunk_doc_type(chunk) if key == "doc_type" else meta.get(key)
            if not cls._metadata_value_matches(actual, expected):
                return False
        return True

    @staticmethod
    def _meta_title(meta: Dict[str, Any]) -> str:
        return meta.get("book_title") or meta.get("title") or ""

    @staticmethod
    def _meta_author(meta: Dict[str, Any]) -> str:
        return meta.get("book_author") or meta.get("author") or ""

    def search(
        self,
        query_embedding: List[float],
        *,
        k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
        doc_type: Optional[str] = None,
        diverse: bool = True,
        relevance_threshold_drop: float = 0.05,
        candidate_multiplier: int = 5,
    ) -> List[Dict[str, Any]]:
        if self._normalized_embeddings_matrix is None or len(self._chunks) == 0:
            return []
            
        k = k or self._settings.TOP_K_RESULTS
        effective_filters = dict(filters or {})
        if doc_type:
            effective_filters["doc_type"] = doc_type
        
        q_vec = np.array(query_embedding, dtype=np.float32)
        
        # Compute cosine similarity
        q_norm = np.linalg.norm(q_vec)
        if q_norm == 0:
            return []
        q_vec = q_vec / q_norm
        similarities = np.dot(self._normalized_embeddings_matrix, q_vec)
        
        # Handle filters
        valid_indices = []
        for i, chunk in enumerate(self._chunks):
            if not self._metadata_matches(chunk, effective_filters):
                continue
            valid_indices.append(i)
            
        if not valid_indices:
            return []
            
        valid_indices = np.array(valid_indices)
        valid_similarities = similarities[valid_indices]
        
        candidate_k = max(k * candidate_multiplier, 50) if diverse else k
        
        # Get top candidates
        top_k_rel_indices = np.argsort(valid_similarities)[::-1][:candidate_k]
        top_k_abs_indices = valid_indices[top_k_rel_indices]
        
        candidates = []
        for i in top_k_abs_indices:
            sim = float(similarities[i])
            dist = 1.0 - sim
            chunk = dict(self._chunks[i])
            chunk["distance"] = dist
            chunk["similarity"] = sim
            candidates.append(chunk)
            
        if not candidates:
            return []
            
        if not diverse:
            return candidates[:k]
            
        # ── Diverse Logic (Book-Level Grouping) ──
        
        best_sim = candidates[0]["similarity"]
        min_sim_allowed = best_sim - relevance_threshold_drop
        
        # 1. Filter out chunks that are too far from the best match
        filtered_candidates = [c for c in candidates if c["similarity"] >= min_sim_allowed]
        
        # 2. Group by book_id
        grouped = defaultdict(list)
        for c in filtered_candidates:
            book_id = c["metadata"].get("book_id", "")
            grouped[book_id].append(c)
            
        # 3. Sort books by their absolute best chunk
        sorted_books = sorted(grouped.keys(), key=lambda b: grouped[b][0]["similarity"], reverse=True)
        
        results = []
        chunks_per_book = defaultdict(int)
        
        # 4. Round-robin selection: take up to 2 chunks per book max, until k is reached
        while len(results) < k:
            added_in_round = False
            for book_id in sorted_books:
                if len(results) >= k:
                    break
                book_chunks = grouped[book_id]
                idx = chunks_per_book[book_id]
                if idx < len(book_chunks) and idx < 2:
                    results.append(book_chunks[idx])
                    chunks_per_book[book_id] += 1
                    added_in_round = True
                    
            if not added_in_round:
                break

        if len(results) < k:
            seen_ids = {item.get("id") for item in results}
            for candidate in filtered_candidates:
                if len(results) >= k:
                    break
                if candidate.get("id") in seen_ids:
                    continue
                results.append(candidate)
                seen_ids.add(candidate.get("id"))
                
        return results

    # ── Collection info ─────────────────────────────────────────────────

    def get_all_books(self) -> List[Dict[str, Any]]:
        books = {}
        for chunk in self._chunks:
            meta = chunk.get("metadata", {})
            if not meta:
                continue
            book_id = meta.get("book_id")
            if not book_id:
                continue

            doc_type = self._chunk_doc_type(chunk)
            if book_id and book_id not in books:
                books[book_id] = {
                    "book_id": book_id,
                    "title": self._meta_title(meta),
                    "author": self._meta_author(meta),
                    "description": meta.get("description", ""),
                    "genre": meta.get("genre", ""),
                    "genres": meta.get("genres", []),
                    "tags": meta.get("tags", []),
                    "language": meta.get("language", ""),
                    "series": meta.get("series", ""),
                    "series_number": meta.get("series_number", ""),
                    "publication_year": meta.get("publication_year", ""),
                    "publication_date": meta.get("publication_date", meta.get("publication_year", "")),
                    "cover_url": meta.get("cover_url", ""),
                    "license": meta.get("license", ""),
                    "rights_status": meta.get("rights_status", ""),
                    "source_url": meta.get("source_url", ""),
                    "num_chunks": 0,
                }

            if doc_type == DOC_TYPE_BOOK_PROFILE and book_id in books:
                books[book_id].update({
                    "title": self._meta_title(meta) or books[book_id]["title"],
                    "author": self._meta_author(meta) or books[book_id]["author"],
                    "description": meta.get("description", books[book_id].get("description", "")),
                    "genre": meta.get("genre", books[book_id].get("genre", "")),
                    "genres": meta.get("genres", books[book_id].get("genres", [])),
                    "tags": meta.get("tags", books[book_id].get("tags", [])),
                    "language": meta.get("language", books[book_id].get("language", "")),
                    "series": meta.get("series", books[book_id].get("series", "")),
                    "series_number": meta.get("series_number", books[book_id].get("series_number", "")),
                    "publication_year": meta.get("publication_year", books[book_id].get("publication_year", "")),
                    "publication_date": meta.get("publication_date", books[book_id].get("publication_date", "")),
                    "cover_url": meta.get("cover_url", books[book_id].get("cover_url", "")),
                    "license": meta.get("license", books[book_id].get("license", "")),
                    "rights_status": meta.get("rights_status", books[book_id].get("rights_status", "")),
                    "source_url": meta.get("source_url", books[book_id].get("source_url", "")),
                })

            if book_id in books:
                if doc_type == DOC_TYPE_BOOK_CHUNK:
                    books[book_id]["num_chunks"] += 1
                
        return list(books.values())

    def get_book(self, book_id: str) -> Optional[Dict[str, Any]]:
        for b in self.get_all_books():
            if b["book_id"] == book_id:
                return b
        return None

    def get_book_content(self, book_id: str) -> str:
        chunks = []
        for chunk in self._chunks:
            meta = chunk.get("metadata", {})
            if meta.get("book_id") == book_id and self._chunk_doc_type(chunk) == DOC_TYPE_BOOK_CHUNK:
                idx = meta.get("chunk_index", 0)
                chunks.append((idx, chunk.get("text", "")))
                
        chunks.sort(key=lambda x: x[0])
        return "\n\n".join(text for _, text in chunks)

    def delete_book(self, book_id: str) -> int:
        indices_to_keep = []
        for i, chunk in enumerate(self._chunks):
            if chunk.get("metadata", {}).get("book_id") != book_id:
                indices_to_keep.append(i)
                
        deleted = len(self._chunks) - len(indices_to_keep)
        if deleted > 0:
            self._chunks = [self._chunks[i] for i in indices_to_keep]
            if self._embeddings_matrix is not None:
                self._embeddings_matrix = self._embeddings_matrix[indices_to_keep]
                self._refresh_normalized_embeddings()
            self._save_to_disk()
            
        logger.info("Deleted %d chunks for book %s", deleted, book_id)
        return deleted
        
    def get_collection_count(self) -> int:
        return self.count

    @property
    def count(self) -> int:
        return len(self._chunks)


# ── Module-level convenience (lazy singleton) ───────────────────────────

_default_retriever: Optional[NumpyRetriever] = None

def get_retriever(settings: Optional[Settings] = None) -> NumpyRetriever:
    """Return a module-level singleton retriever instance."""
    global _default_retriever
    if _default_retriever is None:
        _default_retriever = NumpyRetriever(settings)
    return _default_retriever

Retriever = NumpyRetriever
