"""
Book file parser supporting TXT, EPUB, PDF, and FB2 formats.

Extracts text content and metadata (title, author) from each format,
returning a unified BookDocument model.
"""

import logging
import xml.etree.ElementTree as ET
from pathlib import Path

import chardet
from bs4 import BeautifulSoup
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class BookDocument(BaseModel):
    """Unified representation of a parsed book file."""

    title: str
    author: str
    text: str
    format: str  # 'txt', 'epub', 'pdf', 'fb2'
    metadata: dict = {}


# ---------------------------------------------------------------------------
# Format-specific helpers
# ---------------------------------------------------------------------------

def _parse_txt(filepath: Path) -> BookDocument:
    """Parse a plain-text file with automatic encoding detection."""

    raw_bytes = filepath.read_bytes()
    detected = chardet.detect(raw_bytes)
    encoding = detected.get("encoding") or "utf-8"
    confidence = detected.get("confidence", 0)
    logger.info(
        "TXT encoding detected: %s (confidence %.2f) for %s",
        encoding, confidence, filepath.name,
    )

    text = raw_bytes.decode(encoding, errors="replace")

    # Derive title from the filename (strip extension).
    title = filepath.stem.replace("_", " ").replace("-", " ").strip()

    return BookDocument(
        title=title,
        author="Unknown",
        text=text,
        format="txt",
        metadata={"encoding": encoding, "encoding_confidence": confidence},
    )


def _parse_epub(filepath: Path) -> BookDocument:
    """Parse an EPUB file using *ebooklib* and *BeautifulSoup*."""

    import ebooklib
    from ebooklib import epub

    book = epub.read_epub(str(filepath), options={"ignore_ncx": True})

    # --- metadata -----------------------------------------------------------
    title = "Unknown"
    raw_title = book.get_metadata("DC", "title")
    if raw_title:
        title = raw_title[0][0]

    author = "Unknown"
    raw_author = book.get_metadata("DC", "creator")
    if raw_author:
        author = raw_author[0][0]

    # Collect any extra Dublin-Core metadata.
    extra_meta: dict = {}
    for field in ("language", "publisher", "date", "identifier", "subject"):
        values = book.get_metadata("DC", field)
        if values:
            extra_meta[field] = values[0][0]

    # --- text ---------------------------------------------------------------
    text_parts: list[str] = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        html_content = item.get_content()
        soup = BeautifulSoup(html_content, "html.parser")
        part_text = soup.get_text(separator="\n", strip=True)
        if part_text:
            text_parts.append(part_text)

    text = "\n\n".join(text_parts)

    return BookDocument(
        title=title,
        author=author,
        text=text,
        format="epub",
        metadata=extra_meta,
    )


def _parse_pdf(filepath: Path) -> BookDocument:
    """Parse a PDF file using *PyPDF2*."""

    from PyPDF2 import PdfReader

    reader = PdfReader(str(filepath))

    # --- metadata -----------------------------------------------------------
    info = reader.metadata or {}
    title = info.title if info.title else filepath.stem.replace("_", " ").replace("-", " ").strip()
    author = info.author if info.author else "Unknown"

    extra_meta: dict = {}
    if info.subject:
        extra_meta["subject"] = info.subject
    if info.creator:
        extra_meta["creator"] = info.creator
    extra_meta["num_pages"] = len(reader.pages)

    # --- text ---------------------------------------------------------------
    text_parts: list[str] = []
    for page_num, page in enumerate(reader.pages):
        try:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(page_text)
        except Exception:
            logger.warning("Could not extract text from page %d of %s", page_num, filepath.name)

    text = "\n\n".join(text_parts)

    return BookDocument(
        title=title,
        author=author,
        text=text,
        format="pdf",
        metadata=extra_meta,
    )


def _parse_fb2(filepath: Path) -> BookDocument:
    """Parse an FB2 (FictionBook 2) XML file."""

    raw_bytes = filepath.read_bytes()
    detected = chardet.detect(raw_bytes)
    encoding = detected.get("encoding") or "utf-8"
    xml_text = raw_bytes.decode(encoding, errors="replace")

    root = ET.fromstring(xml_text)

    # FB2 uses a default namespace; strip it for easier XPath queries.
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    # --- metadata -----------------------------------------------------------
    title = "Unknown"
    author = "Unknown"

    title_el = root.find(f".//{ns}title-info/{ns}book-title")
    if title_el is not None and title_el.text:
        title = title_el.text.strip()

    author_el = root.find(f".//{ns}title-info/{ns}author")
    if author_el is not None:
        first = author_el.findtext(f"{ns}first-name") or ""
        middle = author_el.findtext(f"{ns}middle-name") or ""
        last = author_el.findtext(f"{ns}last-name") or ""
        author = " ".join(part for part in (first, middle, last) if part).strip() or "Unknown"

    extra_meta: dict = {}
    lang_el = root.find(f".//{ns}title-info/{ns}lang")
    if lang_el is not None and lang_el.text:
        extra_meta["language"] = lang_el.text.strip()

    genre_el = root.find(f".//{ns}title-info/{ns}genre")
    if genre_el is not None and genre_el.text:
        extra_meta["genre"] = genre_el.text.strip()

    # --- text ---------------------------------------------------------------
    def _iter_text(element: ET.Element) -> str:
        """Recursively extract text from an XML element and its children."""
        parts: list[str] = []
        if element.text:
            parts.append(element.text.strip())
        for child in element:
            parts.append(_iter_text(child))
            if child.tail:
                parts.append(child.tail.strip())
        return " ".join(p for p in parts if p)

    text_parts: list[str] = []
    for section in root.iter(f"{ns}section"):
        section_text = _iter_text(section)
        if section_text:
            text_parts.append(section_text)

    text = "\n\n".join(text_parts)

    return BookDocument(
        title=title,
        author=author,
        text=text,
        format="fb2",
        metadata=extra_meta,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_PARSERS = {
    ".txt": _parse_txt,
    ".epub": _parse_epub,
    ".pdf": _parse_pdf,
    ".fb2": _parse_fb2,
}

SUPPORTED_EXTENSIONS: set[str] = set(_PARSERS.keys())


def parse_book(filepath: str | Path) -> BookDocument:
    """Parse a book file and return a :class:`BookDocument`.

    Args:
        filepath: Path (or string path) to the book file.

    Returns:
        A ``BookDocument`` with extracted text and metadata.

    Raises:
        FileNotFoundError: If *filepath* does not exist.
        ValueError: If the file extension is not supported.
    """

    filepath = Path(filepath)

    if not filepath.exists():
        raise FileNotFoundError(f"Book file not found: {filepath}")

    ext = filepath.suffix.lower()
    parser = _PARSERS.get(ext)
    if parser is None:
        raise ValueError(
            f"Unsupported file format '{ext}'. "
            f"Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    logger.info("Parsing %s file: %s", ext.upper(), filepath.name)

    try:
        doc = parser(filepath)
    except Exception as exc:
        logger.error("Failed to parse %s: %s", filepath.name, exc, exc_info=True)
        raise

    logger.info(
        "Parsed '%s' by %s — %d characters extracted",
        doc.title, doc.author, len(doc.text),
    )
    return doc
