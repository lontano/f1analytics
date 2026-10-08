from functools import cached_property
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    auth_required: bool = False
    force_secure_cookies: bool = False

    @field_validator("auth_required", "force_secure_cookies", mode="before")
    @classmethod
    def _parse_bool(cls, value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    api_host: str = "127.0.0.1"
    api_port: int = 18700
    ui_port: int = 18701

    google_client_id: str = ""
    google_client_secret: str = ""
    auth_allowlist: str = ""
    auth_admins: str = ""

    session_token_pepper: str = "dev-insecure-pepper-change-me"
    session_ttl_days: int = 30
    session_cookie_name: str = "f1a_session"

    web_origin: str = "http://localhost:18701,http://127.0.0.1:18701"
    public_origin: str = "https://f1analytics.gelosoft.app"
    public_hostname: str = "f1analytics.gelosoft.app"

    data_dir: Path = Path("data")
    timing_live_upstream: str = "http://127.0.0.1:4000"
    timing_schedule_upstream: str = "http://127.0.0.1:4010"

    @cached_property
    def resolved_data_dir(self) -> Path:
        if self.data_dir.is_absolute():
            return self.data_dir
        return (ROOT / self.data_dir).resolve()

    @cached_property
    def cors_origins(self) -> list[str]:
        raw = f"{self.web_origin},{self.public_origin}"
        return sorted({origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()})

    @property
    def allowlist_emails(self) -> set[str]:
        return {email.strip().lower() for email in self.auth_allowlist.split(",") if email.strip()}

    @property
    def admin_emails(self) -> set[str]:
        return {email.strip().lower() for email in self.auth_admins.split(",") if email.strip()}

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id.strip() and self.google_client_secret.strip())

    @property
    def gis_configured(self) -> bool:
        return bool(self.google_client_id.strip())


settings = Settings()
