from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.deps import require_user
from app.services.auth_session import (
    SessionUser,
    clear_session_cookie,
    cookies_secure,
    email_allowed,
    issue_session,
    revoke_session,
    role_for,
    set_session_cookie,
)
from app.services.google_sso import (
    InvalidGoogleTokenError,
    InvalidOAuthStateError,
    OAUTH_NONCE_COOKIE,
    build_google_auth_url,
    callback_uri,
    decode_oauth_state,
    encode_oauth_state,
    exchange_auth_code,
    is_allowed_next_origin,
    new_oauth_nonce,
    verify_google_id_token,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class GoogleSignInBody(BaseModel):
    id_token: str = Field(min_length=20)


class DevSignInBody(BaseModel):
    email: str = "dev@local"
    name: str = "Dev User"


def _public_user(user: SessionUser) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


@router.get("/config")
def auth_config() -> dict:
    return {
        "google_enabled": settings.gis_configured,
        "redirect_enabled": settings.google_configured,
        "google_client_id": settings.google_client_id or None,
        "auth_required": settings.auth_required,
        "dev_bypass": not settings.auth_required,
    }


@router.post("/google")
def auth_google(body: GoogleSignInBody, request: Request) -> dict:
    try:
        claims = verify_google_id_token(body.id_token)
    except InvalidGoogleTokenError as exc:
        raise HTTPException(status_code=401, detail=exc.kind) from None
    if not email_allowed(claims.email):
        raise HTTPException(status_code=403, detail="not_invited")
    role = role_for(claims.email, claims.sub, claims.name)
    token, user = issue_session(google_sub=claims.sub, email=claims.email, name=claims.name, role=role)
    from fastapi.responses import JSONResponse

    response = JSONResponse(_public_user(user))
    set_session_cookie(response, token, secure=cookies_secure(request))
    return response


@router.get("/google/start")
def auth_google_start(
    request: Request,
    next: str = Query(...),
    invite: str | None = Query(default=None),
) -> RedirectResponse:
    if not settings.google_configured:
        raise HTTPException(status_code=503, detail="google_not_configured")
    if not is_allowed_next_origin(next):
        raise HTTPException(status_code=400, detail="invalid_next")
    nonce = new_oauth_nonce()
    redirect = callback_uri(request)
    state = encode_oauth_state(nonce=nonce, next_origin=next, redirect_uri=redirect, invite=invite)
    out = RedirectResponse(build_google_auth_url(state=state, redirect_uri=redirect), status_code=302)
    out.set_cookie(
        OAUTH_NONCE_COOKIE,
        nonce,
        httponly=True,
        secure=cookies_secure(request),
        samesite="lax",
        max_age=600,
        path="/v1/auth/google",
    )
    return out


@router.get("/google/callback")
async def auth_google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    f1a_oauth_nonce: str | None = Cookie(default=None),
) -> RedirectResponse:
    fallback = settings.cors_origins[0] if settings.cors_origins else settings.public_origin

    def fail(reason: str, origin: str | None = None) -> RedirectResponse:
        target = (origin or fallback).rstrip("/")
        out = RedirectResponse(f"{target}/?signin_error={reason}", status_code=302)
        out.delete_cookie(OAUTH_NONCE_COOKIE, path="/v1/auth/google")
        return out

    if error == "access_denied":
        return fail("access_denied")
    if not code or not state:
        return fail("failed")
    try:
        oauth = decode_oauth_state(state)
    except InvalidOAuthStateError:
        return fail("failed")
    if not f1a_oauth_nonce or not hmac_equal(f1a_oauth_nonce, oauth.nonce):
        return fail("failed", oauth.next_origin)
    try:
        claims = await exchange_auth_code(code=code, redirect_uri=oauth.redirect_uri)
    except InvalidGoogleTokenError:
        return fail("failed", oauth.next_origin)
    if not email_allowed(claims.email):
        return fail("not_invited", oauth.next_origin)
    role = role_for(claims.email, claims.sub, claims.name)
    token, _user = issue_session(google_sub=claims.sub, email=claims.email, name=claims.name, role=role)
    out = RedirectResponse(oauth.next_origin.rstrip("/") + "/", status_code=302)
    set_session_cookie(out, token, secure=cookies_secure(request))
    out.delete_cookie(OAUTH_NONCE_COOKIE, path="/v1/auth/google")
    return out


@router.post("/dev")
def auth_dev(body: DevSignInBody, request: Request) -> dict:
    if settings.auth_required:
        raise HTTPException(status_code=403, detail="dev_bypass_disabled")
    email = body.email.strip().lower()
    from fastapi.responses import JSONResponse

    role = role_for(email, f"dev:{email}", body.name)
    token, user = issue_session(google_sub=f"dev:{email}", email=email, name=body.name, role=role)
    response = JSONResponse(_public_user(user))
    set_session_cookie(response, token, secure=cookies_secure(request))
    return response


@router.post("/logout")
def auth_logout(
    response_user: SessionUser = Depends(require_user),
    session: str | None = Cookie(default=None, alias=settings.session_cookie_name),
) -> dict:
    del response_user
    from fastapi.responses import JSONResponse

    revoke_session(session)
    response = JSONResponse({"ok": True})
    clear_session_cookie(response)
    return response


def hmac_equal(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)
