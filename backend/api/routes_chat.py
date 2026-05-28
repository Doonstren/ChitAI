"""
Chat / НейроЧат ендпоінти для ЧитAI.

POST /api/chat — AI-чат з пошуком по книгах (RAG).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from middleware.auth import optional_auth
from middleware.rate_limiter import limiter, CHAT_RATE_LIMIT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["НейроЧат"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Тіло запиту до AI-чату."""
    message: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Повідомлення користувача",
    )
    book_id: Optional[str] = Field(
        default=None,
        description="ID книги для пошуку лише в ній (необов'язково)",
    )


class BookCard(BaseModel):
    """Карточка книги у відповіді."""
    book_id: str
    title: str
    author: str
    description: str = ""
    genres: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    language: str = ""
    series: str = ""
    series_number: str = ""
    publication_year: str = ""
    publication_date: str = ""
    cover_url: str = ""
    license: str = ""
    rights_status: str = ""
    source_url: str = ""
    relevance_score: float = 0.0


class Source(BaseModel):
    """Посилання на фрагмент тексту-джерело."""
    text: str
    book_title: str
    chunk_index: int


class ChatResponse(BaseModel):
    """Відповідь AI-чату."""
    answer: str
    books: list[BookCard] = []
    sources: list[Source] = []


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="AI-чат з пошуком по книгах",
    description="Надсилає повідомлення до НейроЧат і отримує відповідь з посиланнями на книги.",
)
@limiter.limit(CHAT_RATE_LIMIT)
async def chat(
    request: Request,         # required by slowapi
    body: ChatRequest = Body(...),
    user: Optional[dict] = Depends(optional_auth),
):
    """
    Основний ендпоінт AI-чату.

    - Авторизація необов'язкова (працює і без логіну).
    - Якщо `book_id` вказано — пошук лише по цій книзі.
    """
    # Lazy import щоб уникнути циклічних залежностей
    from core.engine import get_engine

    try:
        engine = get_engine()
        filters = {"book_id": body.book_id} if body.book_id else None
        result_obj = engine.chat(
            user_message=body.message,
            filters=filters,
        )
        
        # Перетворюємо ChatResponse об'єкт у словник
        result = {
            "answer": result_obj.answer,
            "books": result_obj.books,
            "sources": [], # З chunks можна дістати, але поки RAGEngine не повертає sources окремо
        }
    except Exception as exc:
        logger.error("Помилка RAG-движка: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не вдалося отримати відповідь. Спробуйте пізніше.",
        )

    # Нормалізуємо відповідь до Pydantic-моделей
    books = [
        BookCard(
            book_id=b.get("book_id", ""),
            title=b.get("title", ""),
            author=b.get("author", ""),
            description=b.get("description", ""),
            genres=b.get("genres", []),
            tags=b.get("tags", []),
            language=b.get("language", ""),
            series=b.get("series", ""),
            series_number=b.get("series_number", ""),
            publication_year=b.get("publication_year", ""),
            publication_date=b.get("publication_date", b.get("publication_year", "")),
            cover_url=b.get("cover_url", ""),
            license=b.get("license", ""),
            rights_status=b.get("rights_status", ""),
            source_url=b.get("source_url", ""),
            relevance_score=b.get("relevance_score", 0.0),
        )
        for b in result.get("books", [])
    ]

    sources = [
        Source(
            text=s.get("text", ""),
            book_title=s.get("book_title", ""),
            chunk_index=s.get("chunk_index", 0),
        )
        for s in result.get("sources", [])
    ]

    return ChatResponse(
        answer=result.get("answer", ""),
        books=books,
        sources=sources,
    )
