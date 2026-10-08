import time

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.services.auth_session import hash_token, issue_session, lookup_session
from app.services.google_sso import (
    InvalidGoogleTokenError,
    InvalidOAuthStateError,
    build_google_auth_url,
    decode_oauth_state,
    encode_oauth_state,
    rejection_kind,
)


@pytest.fixture(autouse=True)
def isolated_data(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "session_token_pepper", "test-pepper")
    monkeypatch.setattr(settings, "web_origin", "http://localhost:18701")
    monkeypatch.setattr(settings, "public_origin", "https://f1analytics.gelosoft.app")
    monkeypatch.setattr(settings, "auth_allowlist", "")
    monkeypatch.setattr(settings, "auth_admins", "")
    monkeypatch.setattr(settings, "auth_required", False)
    monkeypatch.setattr(settings, "google_client_id", "client-id")
    monkeypatch.setattr(settings, "google_client_secret", "client-secret")
    settings.__dict__.pop("resolved_data_dir", None)
    settings.__dict__.pop("cors_origins", None)
    yield


def test_session_stores_only_the_peppered_hash():
    token, user = issue_session(google_sub="sub", email="a@b.c", name="A", role="admin")
    raw = (settings.resolved_data_dir / "sessions.json").read_text(encoding="utf-8")
    assert token not in raw
    assert hash_token(token) in raw
    assert lookup_session(token).email == user.email


def test_oauth_state_roundtrip_and_rejects_tampering():
    state = encode_oauth_state(
        nonce="nonce",
        next_origin="http://localhost:18701",
        redirect_uri="http://localhost:18701/v1/auth/google/callback",
    )
    decoded = decode_oauth_state(state)
    assert decoded.nonce == "nonce"
    assert decoded.next_origin == "http://localhost:18701"
    with pytest.raises(InvalidOAuthStateError):
        decode_oauth_state(state + "ff")
    with pytest.raises(InvalidOAuthStateError):
        encode_then = encode_oauth_state(
            nonce="nonce",
            next_origin="https://evil.example",
            redirect_uri="http://localhost:18701/v1/auth/google/callback",
        )
        decode_oauth_state(encode_then)


def test_oauth_state_expires(monkeypatch):
    real = time.time
    monkeypatch.setattr(time, "time", lambda: 1_000)
    state = encode_oauth_state(
        nonce="nonce",
        next_origin="http://localhost:18701",
        redirect_uri="http://localhost:18701/v1/auth/google/callback",
    )
    monkeypatch.setattr(time, "time", lambda: real())
    monkeypatch.setattr(time, "time", lambda: 1_000 + 601)
    with pytest.raises(InvalidOAuthStateError):
        decode_oauth_state(state)


def test_authorize_url_has_no_client_secret():
    url = build_google_auth_url(state="abc", redirect_uri="https://f1analytics.gelosoft.app/v1/auth/google/callback")
    assert "client-secret" not in url
    assert "client_secret" not in url
    assert "response_type=code" in url


def test_rejection_kind_does_not_keep_the_credential():
    token = "ya29.SECRET-TOKEN-VALUE"
    err = InvalidGoogleTokenError(rejection_kind(ValueError(f"Token used too early: {token}")))
    assert err.kind == "clock-early"
    assert token not in str(err)


def test_dev_sign_in_sets_httponly_cookie_and_blocks_when_required():
    from app.main import app

    client = TestClient(app)
    res = client.post("/v1/auth/dev", json={"email": "dev@local", "name": "Dev"})
    assert res.status_code == 200
    cookie = res.headers["set-cookie"]
    assert "f1a_session=" in cookie
    assert "HttpOnly" in cookie
    assert "dev@local" not in cookie.split(";", 1)[0]
    me = client.get("/v1/me")
    assert me.json()["email"] == "dev@local"
    assert me.json()["role"] == "admin"

    settings.auth_required = True
    denied = client.post("/v1/auth/dev", json={})
    assert denied.status_code == 403


def test_start_uses_forwarded_proto_and_refuses_open_redirect():
    from app.main import app

    client = TestClient(app)
    bad = client.get("/v1/auth/google/start", params={"next": "https://evil.example"}, follow_redirects=False)
    assert bad.status_code == 400

    ok = client.get(
        "/v1/auth/google/start",
        params={"next": "https://f1analytics.gelosoft.app"},
        headers={
            "x-forwarded-proto": "https",
            "x-forwarded-host": "f1analytics.gelosoft.app",
        },
        follow_redirects=False,
    )
    assert ok.status_code == 302
    location = ok.headers["location"]
    assert "client_secret" not in location
    assert "redirect_uri=https%3A%2F%2Ff1analytics.gelosoft.app%2Fv1%2Fauth%2Fgoogle%2Fcallback" in location
    assert "f1a_oauth_nonce=" in ok.headers["set-cookie"]
    assert "Path=/v1/auth/google" in ok.headers["set-cookie"]
