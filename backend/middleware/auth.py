"""
Firebase Authentication middleware для ЧитAI.

Перевіряє Firebase ID токени та надає FastAPI-залежності
для захищених та публічних ендпоінтів.
"""

from __future__ import annotations

import logging
from typing import Optional

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy Firebase Admin SDK initialisation
# ---------------------------------------------------------------------------
_firebase_app: Optional[firebase_admin.App] = None

_bearer_scheme = HTTPBearer(auto_error=False)


def _get_firebase_app() -> firebase_admin.App:
    """Ініціалізує Firebase Admin SDK при першому виклику."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    try:
        # Спробувати отримати вже ініціалізований додаток
        _firebase_app = firebase_admin.get_app()
    except ValueError:
        # Ще не ініціалізовано – створюємо
        from core.config import get_settings  # lazy import

        settings = get_settings()
        service_account_path: str = settings.FIREBASE_SERVICE_ACCOUNT_PATH

        cred = credentials.Certificate(service_account_path)
        _firebase_app = firebase_admin.initialize_app(cred, {
            "projectId": "chitai-f8b4a",
        })
        logger.info("Firebase Admin SDK ініціалізовано (проєкт: chitai-f8b4a)")

    return _firebase_app


# ---------------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------------

def verify_firebase_token(token: str) -> dict:
    """
    Перевіряє Firebase ID-токен і повертає дані користувача.

    Returns:
        dict з полями uid, email, name та іншими claims.

    Raises:
        HTTPException 401 – якщо токен невалідний або прострочений.
    """
    _get_firebase_app()  # ensure initialised

    try:
        decoded = firebase_auth.verify_id_token(token, check_revoked=True)
        return {
            "uid": decoded["uid"],
            "email": decoded.get("email"),
            "name": decoded.get("name"),
            "picture": decoded.get("picture"),
            "email_verified": decoded.get("email_verified", False),
            "claims": decoded,
        }
    except firebase_auth.ExpiredIdTokenError:
        logger.warning("Спроба авторизації з простроченим токеном")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Термін дії токена закінчився. Будь ласка, увійдіть знову.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except firebase_auth.RevokedIdTokenError:
        logger.warning("Спроба авторизації з відкликаним токеном")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен було відкликано. Будь ласка, увійдіть знову.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except firebase_auth.InvalidIdTokenError:
        logger.warning("Невалідний Firebase ID-токен")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невалідний токен авторизації.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as exc:
        logger.error("Помилка верифікації токена: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Помилка авторизації. Спробуйте пізніше.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI-залежність: вимагає валідний Bearer-токен.

    Повертає словник з даними користувача.
    Якщо токен відсутній або невалідний – повертає HTTP 401.
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Необхідна авторизація. Додайте заголовок Authorization: Bearer <token>.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_firebase_token(creds.credentials)


async def optional_auth(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[dict]:
    """
    FastAPI-залежність для публічних ендпоінтів.

    Повертає дані користувача, якщо токен надано і він валідний.
    Повертає None, якщо токен не надано (анонімний доступ).
    """
    if creds is None:
        return None

    try:
        return verify_firebase_token(creds.credentials)
    except HTTPException:
        # Для публічних ендпоінтів невалідний токен == анонімний доступ
        logger.debug("Невалідний токен на публічному ендпоінті – продовжуємо анонімно")
        return None


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    FastAPI-залежність для адмін-ендпоінтів (напр. завантаження книг).

    Вимагає валідний токен + щоб користувач був у списку адмінів
    (``ADMIN_EMAILS`` або ``ADMIN_UIDS`` у налаштуваннях).

    Якщо обидва списки порожні — доступ заборонено всім (ендпоінт замкнено).
    """
    from core.config import get_settings  # lazy import

    settings = get_settings()
    admin_emails = {e.lower() for e in settings.ADMIN_EMAILS}
    admin_uids = set(settings.ADMIN_UIDS)

    uid = user.get("uid") or ""
    email = (user.get("email") or "").lower()

    if (admin_emails and email in admin_emails) or (admin_uids and uid in admin_uids):
        return user

    logger.warning(
        "Відмова в адмін-доступі: uid=%s email=%s", uid, email or "—"
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Доступ дозволено лише адміністраторам.",
    )
