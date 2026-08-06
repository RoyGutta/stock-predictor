"""Shared plumbing for external market data providers.

Every provider here is optional. The app must run fully without any key, and a
feature whose provider is unconfigured has to say so — it must never fall back
to placeholder numbers, because a fabricated market figure is worse than a
missing one.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# httpx logs every request at INFO as a full URL including the query string --
# which is exactly where provider API keys live. Left alone it writes live
# credentials into application logs and any aggregator downstream.
#
# Suppressed here rather than in main.py deliberately: this module is imported
# by anything that can make a provider request, so tests, scripts and workers
# are covered too. Putting it in the app entry point only protects the server.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class Capability(str, Enum):
    """A feature that depends on a provider.

    Exposed through the API so the UI can explain precisely what is unavailable
    and why, instead of rendering an empty panel with no explanation.
    """

    MOVERS = "movers"
    SECTORS = "sectors"
    NEWS = "news"
    SEARCH = "search"
    FUNDAMENTALS = "fundamentals"
    SCREENER = "screener"


class ProviderError(Exception):
    """A provider call failed. The message is safe to show a user."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class ProviderNotConfigured(ProviderError):
    def __init__(self, provider: str, capability: Capability) -> None:
        super().__init__(
            f"{capability.value.replace('_', ' ').title()} needs a {provider} API key. "
            f"Add one to your .env file — see personal.md for where to get a free key.",
            status_code=503,
        )


class ProviderPlanRequired(ProviderError):
    """The key is valid but the endpoint is not on the current plan.

    Distinguished from a generic failure so the UI can say "your plan does not
    include this" rather than "something went wrong", which would send someone
    debugging a key that is working perfectly.
    """

    def __init__(self, provider: str, capability: Capability) -> None:
        super().__init__(
            f"{provider} does not include {capability.value} on its free tier. "
            f"This feature stays disabled rather than showing made-up data.",
            status_code=501,
        )


async def get_json(
    client: httpx.AsyncClient,
    url: str,
    params: dict[str, Any],
    *,
    provider: str,
    capability: Capability,
) -> Any:
    """Perform one provider request and normalise its failure modes.

    Provider errors are logged with the URL but never with the key, and the
    caller receives a message that does not leak either.
    """
    try:
        response = await client.get(url, params=params)
    except httpx.TimeoutException as exc:
        logger.warning("%s timed out for %s", provider, capability.value)
        raise ProviderError(f"{provider} did not respond in time. Try again shortly.") from exc
    except httpx.HTTPError as exc:
        logger.warning(
            "%s transport error for %s: %s", provider, capability.value, type(exc).__name__
        )
        raise ProviderError(f"Could not reach {provider}. Try again shortly.") from exc

    if response.status_code in (401, 403):
        # 403 is also what FMP returns for a retired endpoint, so inspect the body.
        body = response.text[:200].lower()
        if "legacy" in body or "not available under your" in body or "upgrade" in body:
            raise ProviderPlanRequired(provider, capability)
        raise ProviderError(
            f"{provider} rejected the API key. Check the value in your .env file.",
            status_code=502,
        )
    if response.status_code == 402:
        raise ProviderPlanRequired(provider, capability)
    if response.status_code == 429:
        raise ProviderError(
            f"{provider}'s rate limit was reached. Data will be available again shortly.",
            status_code=429,
        )
    if response.status_code >= 400:
        logger.warning(
            "%s returned HTTP %s for %s", provider, response.status_code, capability.value
        )
        raise ProviderError(f"{provider} returned an error. Try again shortly.")

    try:
        payload = response.json()
    except ValueError as exc:
        raise ProviderError(f"{provider} returned a malformed response.") from exc

    # Some providers signal errors in a 200 body.
    if isinstance(payload, dict):
        message = payload.get("Error Message") or payload.get("error")
        if message:
            lowered = str(message).lower()
            if "legacy" in lowered or "upgrade" in lowered or "plan" in lowered:
                raise ProviderPlanRequired(provider, capability)
            logger.warning("%s error body for %s", provider, capability.value)
            raise ProviderError(f"{provider} could not serve that request.")

    return payload


def build_client() -> httpx.AsyncClient:
    settings = get_settings()
    return httpx.AsyncClient(
        timeout=settings.provider_timeout,
        headers={"User-Agent": "stock-predictor/0.3 (educational)"},
        follow_redirects=True,
    )


def as_float(value: Any) -> float | None:
    """Coerce a provider field to float, or None. Never silently zero."""
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None  # reject NaN
