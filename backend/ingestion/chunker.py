"""
Semantic text chunker for book documents.

Splits book text into overlapping chunks using a recursive strategy that
tries progressively finer separators: chapters → paragraphs → sentences →
characters.  Designed for Ukrainian / Russian text where 1 token ≈ 4 chars.
"""

import logging
import re

from pydantic import BaseModel

from ingestion.parser import BookDocument

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class Chunk(BaseModel):
    """A single text chunk ready for embedding and storage."""

    text: str
    chunk_index: int
    book_id: str
    book_title: str
    book_author: str
    metadata: dict = {}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Approximate chars-per-token for Cyrillic text (Ukrainian / Russian).
_CHARS_PER_TOKEN: int = 4

# Ordered list of separators from coarsest to finest.
_SEPARATORS: list[str] = [
    "\n\n\n",   # chapter / large section breaks
    "\n\n",     # paragraph breaks
    "\n",       # line breaks
    ". ",       # sentence endings (period)
    "! ",       # sentence endings (exclamation)
    "? ",       # sentence endings (question)
    "; ",       # clause separators
    ", ",       # comma
    " ",        # word boundaries
    "",         # character-level (last resort)
]


def _char_limit(tokens: int) -> int:
    """Convert an approximate token count to a character count."""
    return tokens * _CHARS_PER_TOKEN


def _recursive_split(
    text: str,
    max_chars: int,
    separators: list[str],
) -> list[str]:
    """Recursively split *text* into pieces no larger than *max_chars*.

    Tries separators from coarsest to finest.  If a piece is still too
    large after splitting on the current separator, the next separator in
    the list is used.
    """

    if len(text) <= max_chars:
        return [text]

    # Pick the first separator that actually appears in the text.
    sep = ""
    remaining_seps = separators
    for i, candidate in enumerate(separators):
        if candidate and candidate in text:
            sep = candidate
            remaining_seps = separators[i + 1 :]
            break
    else:
        # No separator found – fall back to hard character split.
        remaining_seps = []

    if sep:
        parts = text.split(sep)
    else:
        # Character-level split (last resort).
        parts = [text[i : i + max_chars] for i in range(0, len(text), max_chars)]

    # Merge small consecutive parts so each piece is as close to
    # *max_chars* as possible without exceeding it.
    merged: list[str] = []
    current = ""
    for part in parts:
        candidate = (current + sep + part) if current else part
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                merged.append(current)
            # If this single part already exceeds the limit, split it
            # further with a finer separator.
            if len(part) > max_chars:
                merged.extend(_recursive_split(part, max_chars, remaining_seps))
                current = ""
            else:
                current = part
    if current:
        merged.append(current)

    return merged


def _add_overlap(chunks: list[str], overlap_chars: int) -> list[str]:
    """Add overlapping context between consecutive chunks.

    Prepends the last *overlap_chars* characters of the previous chunk to
    the beginning of each subsequent chunk (splitting on the nearest word
    boundary to avoid mid-word cuts).
    """

    if overlap_chars <= 0 or len(chunks) <= 1:
        return chunks

    result: list[str] = [chunks[0]]
    for i in range(1, len(chunks)):
        prev = chunks[i - 1]
        overlap_text = prev[-overlap_chars:]

        # Trim to the nearest word boundary so we don't start mid-word.
        space_idx = overlap_text.find(" ")
        if space_idx != -1:
            overlap_text = overlap_text[space_idx + 1 :]

        result.append(overlap_text + chunks[i])
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def chunk_text(
    book: BookDocument,
    book_id: str,
    chunk_size: int = 600,
    chunk_overlap: int = 100,
) -> list[Chunk]:
    """Split a :class:`BookDocument` into overlapping :class:`Chunk` objects.

    Args:
        book: The parsed book document.
        book_id: Unique identifier for the book (used in metadata).
        chunk_size: Target chunk size in *approximate tokens*
            (1 token ≈ 4 chars for Ukrainian/Russian).
        chunk_overlap: Number of *approximate tokens* to overlap between
            consecutive chunks for context continuity.

    Returns:
        A list of ``Chunk`` objects with full metadata.
    """

    text = book.text.strip()
    if not text:
        logger.warning("Book '%s' has no text to chunk.", book.title)
        return []

    max_chars = _char_limit(chunk_size)
    overlap_chars = _char_limit(chunk_overlap)

    # 1. Recursively split text into pieces within the size limit.
    raw_chunks = _recursive_split(text, max_chars, _SEPARATORS)

    # 2. Filter out empty / whitespace-only pieces.
    raw_chunks = [c.strip() for c in raw_chunks if c.strip()]

    # 3. Add overlap for context continuity.
    overlapped = _add_overlap(raw_chunks, overlap_chars)

    # 4. Build Chunk models.
    chunks: list[Chunk] = []
    for idx, chunk_text_str in enumerate(overlapped):
        chunks.append(
            Chunk(
                text=chunk_text_str,
                chunk_index=idx,
                book_id=book_id,
                book_title=book.title,
                book_author=book.author,
                metadata={
                    "format": book.format,
                    "chunk_char_len": len(chunk_text_str),
                    **book.metadata,
                },
            )
        )

    logger.info(
        "Chunked '%s' into %d chunks (target ≈%d tokens, overlap ≈%d tokens)",
        book.title, len(chunks), chunk_size, chunk_overlap,
    )
    return chunks
