"""
Semantic search ендпоінти для ЧитAI.

GET /api/search — семантичний пошук по всіх книгах.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from middleware.rate_limiter import limiter, SEARCH_RATE_LIMIT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Пошук"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class BookCard(BaseModel):
    """Карточка книги у результатах пошуку."""
    book_id: str
    title: str
    author: str
    description: str = ""
    relevance_score: float = 0.0


class SearchResponse(BaseModel):
    """Відповідь пошуку з пагінацією."""
    results: list[BookCard] = []
    total: int = 0
    limit: int = 10
    offset: int = 0


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get(
    "/search",
    response_model=SearchResponse,
    summary="Семантичний пошук книг",
    description="Шукає книги за змістом, автором або жанром з використанням AI.",
)
@limiter.limit(SEARCH_RATE_LIMIT)
async def search_books(
    request: Request,  # required by slowapi
    q: str = Query(
        ...,
        min_length=1,
        max_length=500,
        description="Пошуковий запит",
    ),
    genre: Optional[str] = Query(
        default=None,
        description="Фільтр за жанром",
    ),
    author: Optional[str] = Query(
        default=None,
        description="Фільтр за автором",
    ),
    limit: int = Query(
        default=10,
        ge=1,
        le=50,
        description="Кількість результатів",
    ),
    offset: int = Query(
        default=0,
        ge=0,
        description="Зміщення для пагінації",
    ),
):
    """
    Семантичний пошук по всіх книгах бібліотеки.

    Не потребує авторизації.
    """
    from core.engine import RAGEngine

    # Збираємо фільтри
    filters: dict = {}
    if genre:
        filters["genre"] = genre
    if author:
        filters["author"] = author

    try:
        engine = RAGEngine()
        # Запитуємо більше результатів для підтримки offset-пагінації
        response = engine.search_books(
            query=q,
            filters=filters if filters else None,
            k=limit + offset,
        )
        raw_results: list[dict] = response.books
    except Exception as exc:
        logger.error("Помилка пошуку: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Помилка під час пошуку. Спробуйте пізніше.",
        )

    # Застосовуємо offset-пагінацію
    paginated = raw_results[offset: offset + limit]
    total = len(raw_results)

    books = [
        BookCard(
            book_id=b.get("book_id", ""),
            title=b.get("title", ""),
            author=b.get("author", ""),
            description=b.get("description", ""),
            relevance_score=b.get("relevance_score", 0.0),
        )
        for b in paginated
    ]

    return SearchResponse(
        results=books,
        total=total,
        limit=limit,
        offset=offset,
    )
