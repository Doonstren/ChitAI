# backend/core/firestore_sync.py
"""
Sync book metadata from NumPy DB to Cloud Firestore.

When a book is ingested, this module writes its card (title, author, genres,
description, cover, etc.) to the ``books/{book_id}`` collection in Firestore.
The frontend reads from Firestore directly — no backend call needed for
the catalog page.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import firestore

logger = logging.getLogger(__name__)

_db = None


def _get_firestore_db():
    """Lazy-init Firestore client reusing the existing Firebase Admin app."""
    global _db
    if _db is not None:
        return _db

    try:
        app = firebase_admin.get_app()
    except ValueError:
        # Admin SDK not initialised yet — init with default creds
        from .config import get_settings
        from firebase_admin import credentials

        settings = get_settings()
        cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred, {"projectId": "chitai-f8b4a"})
        app = firebase_admin.get_app()

    _db = firestore.client(app)
    return _db


def sync_book_to_firestore(book_meta: Dict[str, Any]) -> None:
    """Write or update a book card in Firestore ``books/{book_id}``.

    Only metadata used for the catalog UI is synced.  Full text stays in
    NumPy DB exclusively.

    Args:
        book_meta: dict with at least ``book_id``, ``title``, ``author``.
    """
    book_id = book_meta.get("book_id")
    if not book_id:
        logger.warning("sync_book_to_firestore called without book_id — skipping")
        return

    doc = {
        "book_id": book_id,
        "title": book_meta.get("title", ""),
        "author": book_meta.get("author", ""),
        "description": book_meta.get("description", ""),
        "genres": book_meta.get("genres", []),
        "tags": book_meta.get("tags", []),
        "language": book_meta.get("language", ""),
        "series": book_meta.get("series", ""),
        "series_number": book_meta.get("series_number", ""),
        "publication_year": book_meta.get("publication_year", ""),
        "publication_date": book_meta.get("publication_date", book_meta.get("publication_year", "")),
        "cover_url": book_meta.get("cover_url", ""),
        "license": book_meta.get("license", ""),
        "rights_status": book_meta.get("rights_status", ""),
        "source_url": book_meta.get("source_url", ""),
        "num_chunks": book_meta.get("num_chunks", 0),
    }

    try:
        db = _get_firestore_db()
        db.collection("books").document(book_id).set(doc, merge=True)
        logger.info("Synced book '%s' to Firestore", book_id)
    except Exception as exc:
        # Non-fatal: the book is still in NumPy DB, just not in Firestore yet
        logger.error("Failed to sync book '%s' to Firestore: %s", book_id, exc)


def delete_book_from_firestore(book_id: str) -> None:
    """Remove a book card from Firestore."""
    try:
        db = _get_firestore_db()
        db.collection("books").document(book_id).delete()
        logger.info("Deleted book '%s' from Firestore", book_id)
    except Exception as exc:
        logger.error("Failed to delete book '%s' from Firestore: %s", book_id, exc)


def sync_all_books_to_firestore() -> int:
    """Sync all books from the NumPy retriever to Firestore.

    Useful after re-indexing or for one-time migration.

    Returns:
        Number of books synced.
    """
    from .retriever import get_retriever

    retriever = get_retriever()
    books = retriever.get_all_books()

    for book in books:
        sync_book_to_firestore(book)

    logger.info("Synced %d books to Firestore", len(books))
    return len(books)
