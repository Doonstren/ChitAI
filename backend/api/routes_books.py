"""
Book metadata & ingestion ендпоінти для ЧитAI.

GET  /api/books              — список усіх книг
GET  /api/books/{book_id}    — метадані однієї книги
GET  /api/books/{book_id}/content — повний текст для читання
POST /api/books/ingest       — завантаження та індексація книги (admin)
"""



import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from middleware.auth import require_admin
from middleware.rate_limiter import limiter, BOOKS_RATE_LIMIT, CHAT_RATE_LIMIT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/books", tags=["Книги"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class BookMeta(BaseModel):
    """Метадані книги."""
    book_id: str
    title: str
    author: str
    description: str = ""
    genre: str = ""
    genres: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    language: str = ""
    series: str = ""
    series_number: str = ""
    publication_year: str = ""
    publication_date: str = ""
    license: str = ""
    rights_status: str = ""
    source_url: str = ""
    cover_url: str = ""
    num_chunks: int = 0


class BookListResponse(BaseModel):
    """Список книг."""
    books: list[BookMeta] = []
    total: int = 0


class BookContentResponse(BaseModel):
    """Повний текст книги для читання."""
    book_id: str
    title: str
    author: str = ""
    content: str


class IngestResponse(BaseModel):
    """Результат завантаження книги."""
    book_id: str
    title: str
    author: str
    description: str = ""
    genres: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    series: str = ""
    publication_year: str = ""
    publication_date: str = ""
    license: str = ""
    rights_status: str = ""
    source_url: str = ""
    num_chunks: int
    status: str


# ---------------------------------------------------------------------------
# GET /api/books — список усіх книг
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=BookListResponse,
    summary="Список усіх книг",
    description="Повертає метадані всіх книг у бібліотеці.",
)
@limiter.limit(BOOKS_RATE_LIMIT)
async def list_books(request: Request):
    """Повертає метадані всіх книг. Авторизація не потрібна."""
    from core.retriever import get_retriever

    try:
        retriever = get_retriever()
        raw_books: list[dict] = retriever.get_all_books()
    except Exception as exc:
        logger.error("Помилка отримання списку книг: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося отримати список книг. Спробуйте пізніше.",
        )

    books = [
        BookMeta(
            book_id=b.get("book_id", ""),
            title=b.get("title", ""),
            author=b.get("author", ""),
            description=b.get("description", ""),
            genre=b.get("genre", ""),
            genres=b.get("genres", []),
            tags=b.get("tags", []),
            language=b.get("language", ""),
            series=b.get("series", ""),
            series_number=b.get("series_number", ""),
            publication_year=b.get("publication_year", ""),
            publication_date=b.get("publication_date", b.get("publication_year", "")),
            license=b.get("license", ""),
            rights_status=b.get("rights_status", ""),
            source_url=b.get("source_url", ""),
            cover_url=b.get("cover_url", ""),
            num_chunks=b.get("num_chunks", 0),
        )
        for b in raw_books
    ]

    return BookListResponse(books=books, total=len(books))


# ---------------------------------------------------------------------------
# GET /api/books/{book_id} — одна книга
# ---------------------------------------------------------------------------

@router.get(
    "/{book_id}",
    response_model=BookMeta,
    summary="Метадані книги",
    description="Повертає метадані конкретної книги за її ID.",
)
@limiter.limit(BOOKS_RATE_LIMIT)
async def get_book(request: Request, book_id: str):
    """Повертає метадані однієї книги. Авторизація не потрібна."""
    from core.retriever import get_retriever

    try:
        retriever = get_retriever()
        book: dict | None = retriever.get_book(book_id)
    except Exception as exc:
        logger.error("Помилка отримання книги %s: %s", book_id, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося отримати дані книги. Спробуйте пізніше.",
        )

    if book is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Книгу з ID «{book_id}» не знайдено.",
        )

    return BookMeta(
        book_id=book.get("book_id", book_id),
        title=book.get("title", ""),
        author=book.get("author", ""),
        description=book.get("description", ""),
        genre=book.get("genre", ""),
        genres=book.get("genres", []),
        tags=book.get("tags", []),
        language=book.get("language", ""),
        series=book.get("series", ""),
        series_number=book.get("series_number", ""),
        publication_year=book.get("publication_year", ""),
        publication_date=book.get("publication_date", book.get("publication_year", "")),
        license=book.get("license", ""),
        rights_status=book.get("rights_status", ""),
        source_url=book.get("source_url", ""),
        cover_url=book.get("cover_url", ""),
        num_chunks=book.get("num_chunks", 0),
    )


# ---------------------------------------------------------------------------
# GET /api/books/{book_id}/content — повний текст
# ---------------------------------------------------------------------------

@router.get(
    "/{book_id}/content",
    response_model=BookContentResponse,
    summary="Повний текст книги",
    description="Повертає повний текст книги для читання.",
)
@limiter.limit(BOOKS_RATE_LIMIT)
async def get_book_content(request: Request, book_id: str):
    """Повний текст книги. Авторизація не потрібна."""
    from core.retriever import get_retriever

    retriever = get_retriever()

    # Спершу перевіряємо, що книга існує
    book: dict | None = retriever.get_book(book_id)
    if book is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Книгу з ID «{book_id}» не знайдено.",
        )

    try:
        content: str = retriever.get_book_content(book_id)
    except Exception as exc:
        logger.error(
            "Помилка отримання тексту книги %s: %s", book_id, exc, exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося завантажити текст книги. Спробуйте пізніше.",
        )

    return BookContentResponse(
        book_id=book_id,
        title=book.get("title", ""),
        author=book.get("author", ""),
        content=content,
    )


# ---------------------------------------------------------------------------
# GET /api/books/{book_id}/file — оригінальний файл книги для читання
# ---------------------------------------------------------------------------

_FILE_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".epub": "application/epub+zip",
    ".fb2": "application/x-fictionbook+xml",
}


@router.get(
    "/{book_id}/file",
    summary="Файл книги для читання",
    description="Повертає оригінальний файл книги (PDF тощо) для відкриття у читалці браузера.",
)
@limiter.limit(BOOKS_RATE_LIMIT)
async def get_book_file(request: Request, book_id: str):
    """Віддає оригінальний файл книги з папки на сервері. Авторизація не потрібна."""
    from core.config import get_settings

    # book_id — це slug; забороняємо будь-що інше, щоб уникнути обходу шляху.
    if not re.fullmatch(r"[A-Za-z0-9_-]+", book_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Книгу не знайдено.")

    files_dir = Path(get_settings().BOOKS_FILES_DIR)
    matches = sorted(files_dir.glob(f"{book_id}.*")) if files_dir.exists() else []
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл книги відсутній на сервері.",
        )

    path = matches[0]
    media_type = _FILE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


# ---------------------------------------------------------------------------
# POST /api/books/ingest — завантаження та індексація
# ---------------------------------------------------------------------------

# Дозволені розширення файлів
_ALLOWED_EXTENSIONS = {".txt", ".pdf", ".epub", ".fb2"}


@router.post(
    "/ingest",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Завантажити та індексувати книгу",
    description="Приймає файл книги, парсить та додає до бази. Лише для адміністраторів.",
)
@limiter.limit(CHAT_RATE_LIMIT)  # reuse stricter limit for admin action
async def ingest_book(
    request: Request,
    file: UploadFile = File(..., description="Файл книги (.txt, .pdf, .epub, .fb2)"),
    title: Optional[str] = Form(default=None, description="Назва книги"),
    author: Optional[str] = Form(default=None, description="Автор книги"),
    description: Optional[str] = Form(default=None, description="Короткий опис книги"),
    genres: Optional[str] = Form(default=None, description="Жанри через кому"),
    tags: Optional[str] = Form(default=None, description="Теги через кому"),
    language: Optional[str] = Form(default=None, description="Мова книги"),
    series: Optional[str] = Form(default=None, description="Серія / цикл"),
    series_number: Optional[str] = Form(default=None, description="Номер у серії"),
    aliases: Optional[str] = Form(default=None, description="Альтернативні назви через кому"),
    publication_year: Optional[str] = Form(default=None, description="Рік публікації"),
    publication_date: Optional[str] = Form(default=None, description="Дата виходу"),
    cover_url: Optional[str] = Form(default=None, description="URL обкладинки"),
    license: Optional[str] = Form(default=None, description="Ліцензія показу книги"),
    rights_status: Optional[str] = Form(default=None, description="Статус прав"),
    source_url: Optional[str] = Form(default=None, description="Джерело / сторінка прав"),
    user: dict = Depends(require_admin),
):
    """
    Завантажує та індексує нову книгу.

    - Лише для адміністраторів (Bearer-токен + email/uid у списку адмінів).
    - Приймає файл через multipart/form-data.
    - Опціонально приймає title та author.
    """
    from ingestion.loader import BookLoader

    # Перевірка розширення
    filename = file.filename or "unknown"
    _, ext = os.path.splitext(filename)
    ext = ext.lower()

    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Непідтримуваний формат файлу «{ext}». "
                f"Дозволені: {', '.join(sorted(_ALLOWED_EXTENSIONS))}."
            ),
        )

    # Зберігаємо у тимчасовий файл
    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=ext, prefix="chitai_"
        ) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
    except Exception as exc:
        logger.error("Помилка збереження файлу: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося зберегти завантажений файл.",
        )

    # Індексація
    try:
        loader = BookLoader()
        metadata = {
            "title": title,
            "author": author,
            "description": description,
            "genres": genres,
            "tags": tags,
            "language": language,
            "series": series,
            "series_number": series_number,
            "aliases": aliases,
            "publication_year": publication_year,
            "publication_date": publication_date,
            "cover_url": cover_url,
            "license": license,
            "rights_status": rights_status,
            "source_url": source_url,
        }
        result: dict = loader.ingest_book(filepath=tmp_path, metadata_overrides=metadata)
    except Exception as exc:
        logger.error("Помилка індексації книги: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося проіндексувати книгу. Спробуйте пізніше.",
        )
    finally:
        # Видаляємо тимчасовий файл
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return IngestResponse(
        book_id=result.get("book_id", ""),
        title=result.get("title", title or ""),
        author=result.get("author", author or ""),
        description=result.get("description", ""),
        genres=result.get("genres", []),
        tags=result.get("tags", []),
        series=result.get("series", ""),
        publication_year=result.get("publication_year", ""),
        publication_date=result.get("publication_date", result.get("publication_year", "")),
        license=result.get("license", ""),
        rights_status=result.get("rights_status", ""),
        source_url=result.get("source_url", ""),
        num_chunks=result.get("num_chunks", 0),
        status=result.get("status", "ok"),
    )
