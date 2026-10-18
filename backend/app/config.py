"""Application configuration, loaded from environment variables.

All settings have safe defaults for local development. Anything that would be
unsafe to default (notably CORS in production) fails loudly instead.
"""

from __future__ import annotations

import os
import re
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


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


_EMAIL = re.compile(r"[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}")


def sec_user_agent_problem(value: str) -> str | None:
    """Why a SEC_USER_AGENT value does not satisfy SEC's declared-agent rule.

    SEC asks for an organisation or person name followed by a contact email.
    This checks the shape only; it cannot know whether the contact is real,
    which is why the value must come from the operator and never a default.
    """
    if not value:
        return "SEC_USER_AGENT is not set."
    match = _EMAIL.search(value)
    if match is None:
        return "SEC_USER_AGENT must include a contact email address."
    name = (value[: match.start()] + value[match.end() :]).strip(" <>()-,")
    if len(name) < 2:
        return "SEC_USER_AGENT must include a name before the contact email."
    if "example." in match.group(0).lower():
        return "SEC_USER_AGENT must use a real contact address, not a placeholder."
    return None


@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    api_port: int = field(default_factory=lambda: _int("API_PORT", 8001))
    # Defaults cover `vite dev` (5173) and `vite preview` (4173) on both
    # hostnames. Production must set this explicitly; validate() enforces it.
    cors_allowed_origins: list[str] = field(
        default_factory=lambda: _csv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173"
            ",http://localhost:4173,http://127.0.0.1:4173",
        )
    )
    quote_cache_ttl: int = field(default_factory=lambda: _int("CACHE_TTL_SECONDS", 60))
    # Company names change far less often than prices, so they get their own TTL.
    profile_cache_ttl: int = field(
        default_factory=lambda: _int("PROFILE_CACHE_TTL_SECONDS", 86_400)
    )
    rate_limit_per_minute: int = field(default_factory=lambda: _int("RATE_LIMIT_PER_MINUTE", 60))

    # Optional provider keys. The app runs fully without them; features that
    # need one report that it is missing rather than inventing data.
    finnhub_api_key: str = field(default_factory=lambda: os.getenv("FINNHUB_API_KEY", "").strip())
    fmp_api_key: str = field(default_factory=lambda: os.getenv("FMP_API_KEY", "").strip())

    # Market-wide data (movers, sectors) changes slowly enough that a short
    # cache keeps us far inside the free-tier request budgets.
    market_cache_ttl: int = field(default_factory=lambda: _int("MARKET_CACHE_TTL_SECONDS", 300))
    news_cache_ttl: int = field(default_factory=lambda: _int("NEWS_CACHE_TTL_SECONDS", 900))
    provider_timeout: float = field(
        default_factory=lambda: float(os.getenv("PROVIDER_TIMEOUT_SECONDS", "10"))
    )

    # Public demo: serve a clearly labeled synthetic dataset instead of real
    # market data, because the default price provider is not licensed for
    # public display (TENSIONS T-3, PROVIDERS.md). Never on by default.
    demo_mode: bool = field(
        default_factory=lambda: os.getenv("DEMO_MODE", "").strip().lower() in {"1", "true", "yes"}
    )
    # Which PriceProvider serves price history. Empty means: the synthetic
    # provider when DEMO_MODE is on, otherwise yfinance for local use. The
    # registry validates the choice at startup (see providers/registry.py).
    market_data_provider: str = field(
        default_factory=lambda: os.getenv("MARKET_DATA_PROVIDER", "").strip().lower()
    )

    # SEC EDGAR (filings and XBRL company facts). Free and keyless, but the
    # SEC's fair-access policy requires every automated request to declare who
    # is making it: "Sample Company Name AdminContact@<sample company domain>.com".
    # There is deliberately no default -- a made-up contact would be worse than
    # none. Unset means the SEC panels explain how to enable themselves.
    sec_user_agent: str = field(default_factory=lambda: os.getenv("SEC_USER_AGENT", "").strip())
    # SEC allows at most 10 requests/second across all of a user's machines.
    # The default stays well under that; validate() refuses anything above 9.
    sec_max_requests_per_second: float = field(
        default_factory=lambda: _float("SEC_MAX_REQUESTS_PER_SECOND", 4.0)
    )
    sec_timeout: float = field(default_factory=lambda: _float("SEC_TIMEOUT_SECONDS", 15.0))
    # data.sec.gov sends no ETag or Last-Modified, so freshness is time-based.
    # Submissions change within a second of a filing; facts within a minute.
    sec_submissions_ttl: int = field(
        default_factory=lambda: _int("SEC_SUBMISSIONS_TTL_SECONDS", 600)
    )
    sec_facts_ttl: int = field(default_factory=lambda: _int("SEC_FACTS_TTL_SECONDS", 3_600))
    sec_tickers_ttl: int = field(default_factory=lambda: _int("SEC_TICKERS_TTL_SECONDS", 86_400))
    # When SEC is unreachable, a cached copy up to this old is served with an
    # explicit "stale" flag instead of an error.
    sec_stale_max_age: int = field(
        default_factory=lambda: _int("SEC_STALE_MAX_AGE_SECONDS", 7 * 86_400)
    )

    @property
    def has_sec_user_agent(self) -> bool:
        return sec_user_agent_problem(self.sec_user_agent) is None

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def has_finnhub(self) -> bool:
        return bool(self.finnhub_api_key)

    @property
    def has_fmp(self) -> bool:
        return bool(self.fmp_api_key)

    def validate(self) -> None:
        """Reject configurations that are unsafe to run publicly."""
        if not 0 < self.sec_max_requests_per_second <= 9:
            raise RuntimeError(
                "SEC_MAX_REQUESTS_PER_SECOND must be above 0 and at most 9: SEC's fair-access "
                "policy allows no more than 10 requests per second."
            )
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
