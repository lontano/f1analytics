from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from fastapi import Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.config import settings

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
OAUTH_NONCE_COOKIE = "f1a_oauth_nonce"
STATE_MAX_AGE_SECONDS = 600
CLOCK_SKEW = 60


class InvalidGoogleTokenError(Exception):
    def __init__(self, kind: str = "other") -> None:
        super().__init__(kind)
        self.kind = kind


class InvalidOAuthStateError(Exception):
    pass


@dataclass(frozen=True)
class GoogleClaims:
    sub: str
    email: str
    name: str


@dataclass(frozen=True)
class OAuthState:
    nonce: str
    next_origin: str
    redirect_uri: str
    invite: str | None = None


def rejection_kind(exc: BaseException) -> str:
    text = f"{type(exc).__name__} {exc}".lower()
    if "expired" in text:
        return "expired"
    if "too early" in text or "clock" in text or "iat" in text:
        return "clock-early"
    if "audience" in text:
        return "audience"
    if "issuer" in text:
        return "issuer"
    if "cert" in text or "certificate" in text:
        return "certs"
    return "other"


def verify_google_id_token(token: str) -> GoogleClaims:
    if not settings.gis_configured:
        raise InvalidGoogleTokenError("other")
    try:
        payload = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.google_client_id,
            clock_skew_in_seconds=CLOCK_SKEW,
        )
    except Exception as exc:
        raise InvalidGoogleTokenError(rejection_kind(exc)) from None
    sub = payload.get("sub")
    email = payload.get("email")
    if not isinstance(sub, str) or not isinstance(email, str):
        raise InvalidGoogleTokenError("other")
    if payload.get("email_verified") is False:
        raise InvalidGoogleTokenError("rejected")
    name = payload.get("name") if isinstance(payload.get("name"), str) else email
    return GoogleClaims(sub=sub, email=email.lower(), name=name)


def public_scheme(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    return proto if proto in {"http", "https"} else request.url.scheme


def public_host(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-host")
    host = (forwarded or request.headers.get("host") or request.url.netloc).split(",")[0].strip()
    return host


def callback_uri(request: Request) -> str:
    return f"{public_scheme(request)}://{public_host(request)}/v1/auth/google/callback"


def is_allowed_next_origin(origin: str) -> bool:
    return origin.rstrip("/") in settings.cors_origins


def encode_oauth_state(
    *,
    nonce: str,
    next_origin: str,
    redirect_uri: str,
    invite: str | None = None,
) -> str:
    payload = {
        "n": nonce,
        "next": next_origin,
        "redir": redirect_uri,
        "t": int(time.time()),
    }
    if invite:
        payload["invite"] = invite
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(settings.session_token_pepper.encode(), raw, hashlib.sha256).hexdigest()
    return f"{raw.hex()}.{sig}"


def decode_oauth_state(state: str) -> OAuthState:
    try:
        raw_hex, sig = state.split(".", 1)
        raw = bytes.fromhex(raw_hex)
    except ValueError as exc:
        raise InvalidOAuthStateError from exc
    expected = hmac.new(settings.session_token_pepper.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise InvalidOAuthStateError
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidOAuthStateError from exc
    if abs(time.time() - int(payload.get("t", 0))) > STATE_MAX_AGE_SECONDS:
        raise InvalidOAuthStateError
    nonce, next_origin, redirect_uri = payload.get("n"), payload.get("next"), payload.get("redir")
    if not all(isinstance(value, str) and value for value in (nonce, next_origin, redirect_uri)):
        raise InvalidOAuthStateError
    if not is_allowed_next_origin(next_origin):
        raise InvalidOAuthStateError
    invite = payload.get("invite")
    if invite is not None and not isinstance(invite, str):
        raise InvalidOAuthStateError
    return OAuthState(nonce=nonce, next_origin=next_origin, redirect_uri=redirect_uri, invite=invite)


def build_google_auth_url(*, state: str, redirect_uri: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_auth_code(*, code: str, redirect_uri: str) -> GoogleClaims:
    if not settings.google_configured:
        raise InvalidGoogleTokenError("other")
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if res.status_code >= 400:
        raise InvalidGoogleTokenError("other")
    body = res.json()
    id_tok = body.get("id_token")
    if not isinstance(id_tok, str):
        raise InvalidGoogleTokenError("other")
    return verify_google_id_token(id_tok)


def new_oauth_nonce() -> str:
    return secrets.token_urlsafe(16)
