"""
Головний модуль FastAPI-додатку ЧитAI.

Запуск:
    python -m app
    # або
    uvicorn app:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("chitai")


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown events
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ініціалізація при старті та очищення при зупинці."""
    # --- Startup ---
    logger.info("🚀 ЧитAI API запускається…")

    try:
        from core.config import get_settings
        settings = get_settings()
        logger.info("  ✔ Конфігурацію завантажено")
    except Exception as exc:
        logger.warning("  ⚠ Не вдалося завантажити конфігурацію: %s", exc)

    try:
        from core.retriever import get_retriever
        retriever = get_retriever()
        books_count = retriever.get_collection_count()
        logger.info("  ✔ NumPy DB підключено — %d документів в базі", books_count)
    except Exception as exc:
        logger.warning("  ⚠ Не вдалося ініціалізувати NumPy DB: %s", exc)

    logger.info("✅ ЧитAI API готовий до роботи!")
    yield  # ← application runs here

    # --- Shutdown ---
    logger.info("🛑 ЧитAI API зупиняється…")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ЧитAI API",
    description=(
        "API для інтелектуальної книжкової платформи **ЧитAI**.\n\n"
        "Можливості:\n"
        "- 🤖 **НейроЧат** — AI-асистент з пошуком по книгах (RAG)\n"
        "- 🔍 **Семантичний пошук** — знаходьте книги за змістом\n"
        "- 📚 **Бібліотека** — перегляд та читання книг\n"
        "- 📤 **Індексація** — завантаження нових книг"
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


# ---------------------------------------------------------------------------
# Middleware: CORS
# ---------------------------------------------------------------------------

def _get_cors_origins() -> list[str]:
    """Зчитує дозволені CORS-джерела з налаштувань або .env."""
    try:
        from core.config import get_settings
        settings = get_settings()
        if settings.CORS_ORIGINS:
            return settings.CORS_ORIGINS
    except Exception:
        pass

    # Fallback: стандартні джерела для розробки + Firebase hosting
    return [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://chitai-f8b4a.web.app",
        "https://chitai-f8b4a.firebaseapp.com",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Middleware: Rate limiter
# ---------------------------------------------------------------------------

from middleware.rate_limiter import limiter, rate_limit_exceeded_handler  # noqa: E402

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

from api.routes_chat import router as chat_router      # noqa: E402
from api.routes_search import router as search_router   # noqa: E402
from api.routes_books import router as books_router     # noqa: E402

app.include_router(chat_router)
app.include_router(search_router)
app.include_router(books_router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get(
    "/api/health",
    tags=["Система"],
    summary="Перевірка стану сервера",
)
async def health_check(request: Request):
    """Повертає статус сервера і кількість проіндексованих книг."""
    books_count = 0
    try:
        from core.retriever import get_retriever
        retriever = get_retriever()
        books_count = retriever.get_collection_count()
    except Exception:
        pass

    return {
        "status": "ok",
        "books_count": books_count,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    _host = "0.0.0.0"
    _port = 8000

    try:
        from core.config import get_settings
        _settings = get_settings()
        _host = getattr(_settings, "HOST", _host)
        _port = int(getattr(_settings, "PORT", _port))
    except Exception:
        pass

    uvicorn.run(
        "app:app",
        host=_host,
        port=_port,
        reload=True,
        log_level="info",
    )
