from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status

from app.config import settings
from app.services.auth_session import SessionUser, lookup_session


def get_optional_user(
    session: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> SessionUser | None:
    return lookup_session(session)


def require_user(user: SessionUser | None = Depends(get_optional_user)) -> SessionUser:
    if user:
        return user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
