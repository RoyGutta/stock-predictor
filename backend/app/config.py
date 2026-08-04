"""Application configuration, loaded from environment variables.

All settings have safe defaults for local development. Anything that would be
unsafe to default (notably CORS in production) fails loudly instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Load a repo-root .env if python-dotenv is available. It is a dev convenience
# only -- in production the host injects real environment variables.
try:  # pragma: no cover - trivial import guard
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:  # pragma: no cover
    pass


def _csv(name: str, default: str = "") -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    api_port: int = field(default_factory=lambda: _int("API_PORT", 8001))
    cors_allowed_origins: list[str] = field(
        default_factory=lambda: _csv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        )
    )
    quote_cache_ttl: int = field(default_factory=lambda: _int("CACHE_TTL_SECONDS", 60))
    # Company names change far less often than prices, so they get their own TTL.
    profile_cache_ttl: int = field(
        default_factory=lambda: _int("PROFILE_CACHE_TTL_SECONDS", 86_400)
    )
    rate_limit_per_minute: int = field(default_factory=lambda: _int("RATE_LIMIT_PER_MINUTE", 60))

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def validate(self) -> None:
        """Reject configurations that are unsafe to run publicly."""
        if not self.is_production:
            return
        if "*" in self.cors_allowed_origins:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS must not contain '*' when APP_ENV=production. "
                "Set it to your frontend's exact origin."
            )
        if not self.cors_allowed_origins:
            raise RuntimeError(
                "CORS_ALLOWED_ORIGINS must be set when APP_ENV=production."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate()
    return settings
