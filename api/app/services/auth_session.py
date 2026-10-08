from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from fastapi import Request, Response

from app.config import settings
from app.services.google_sso import public_scheme


@dataclass
class SessionUser:
    id: str
    email: str
    name: str
    role: str


def _path():
    path = settings.resolved_data_dir / "sessions.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load() -> dict[str, Any]:
    path = _path()
    if not path.exists():
        return {"sessions": {}, "users": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def _save(data: dict[str, Any]) -> None:
    path = _path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def hash_token(token: str) -> str:
    return hmac.new(settings.session_token_pepper.encode(), token.encode(), hashlib.sha256).hexdigest()


def email_allowed(email: str) -> bool:
    allow = settings.allowlist_emails
    if not allow:
        return True
    return email.lower() in allow


def cookies_secure(request: Request) -> bool:
    if settings.force_secure_cookies or settings.app_env == "production":
        return True
    return public_scheme(request) == "https"


def role_for(email: str, google_sub: str, name: str) -> str:
    data = _load()
    users: dict[str, Any] = data.setdefault("users", {})
    existing = users.get(google_sub)
    if existing:
        existing["email"] = email.lower()
        existing["name"] = name
        _save(data)
        return str(existing.get("role") or "user")
    has_admin = any(row.get("role") == "admin" for row in users.values())
    role = "admin" if email.lower() in settings.admin_emails or not has_admin else "user"
    users[google_sub] = {"email": email.lower(), "name": name, "role": role}
    _save(data)
    return role


def issue_session(*, google_sub: str, email: str, name: str, role: str) -> tuple[str, SessionUser]:
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + settings.session_ttl_days * 86400
    user = SessionUser(id=google_sub, email=email.lower(), name=name or email, role=role)
    data = _load()
    data.setdefault("sessions", {})[hash_token(token)] = {
        "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role},
        "expires_at": expires_at,
    }
    _save(data)
    return token, user


def lookup_session(token: str | None) -> SessionUser | None:
    if not token:
        return None
    row = _load().get("sessions", {}).get(hash_token(token))
    if not row:
        return None
    if int(row.get("expires_at", 0)) < int(time.time()):
        return None
    user = row["user"]
    return SessionUser(id=user["id"], email=user["email"], name=user["name"], role=user.get("role", "user"))


def revoke_session(token: str | None) -> None:
    if not token:
        return
    data = _load()
    data.get("sessions", {}).pop(hash_token(token), None)
    _save(data)


def set_session_cookie(response: Response, token: str, *, secure: bool) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.session_cookie_name, path="/")
