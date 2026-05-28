"""
Rate-limiter middleware для ЧитAI API.

Використовує slowapi для обмеження кількості запитів за IP-адресою.
Ліміти:
  • /api/chat   – 30 запитів/хв
  • /api/search – 60 запитів/хв
  • /api/books  – 120 запитів/хв
"""

from __future__ import annotations

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.requests import Request
from starlette.responses import JSONResponse

# ---------------------------------------------------------------------------
# Limiter singleton (key_func витягує IP з запиту)
# ---------------------------------------------------------------------------
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["120/minute"],
    storage_uri="memory://",
)

# ---------------------------------------------------------------------------
# Rate-limit constants (used as decorators on route functions)
# ---------------------------------------------------------------------------
CHAT_RATE_LIMIT = "30/minute"
SEARCH_RATE_LIMIT = "60/minute"
BOOKS_RATE_LIMIT = "120/minute"


# ---------------------------------------------------------------------------
# Custom 429 handler with Ukrainian message & Retry-After header
# ---------------------------------------------------------------------------

async def rate_limit_exceeded_handler(
    request: Request,
    exc: RateLimitExceeded,
) -> JSONResponse:
    """Повертає HTTP 429 з інформативним повідомленням українською."""

    # slowapi зберігає значення retry-after у exc.detail
    retry_after = getattr(exc, "retry_after", 60)

    return JSONResponse(
        status_code=429,
        content={
            "detail": (
                "Забагато запитів. Будь ласка, зачекайте та спробуйте знову."
            ),
            "retry_after_seconds": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )
