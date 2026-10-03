"""Chooses the price provider from configuration and refuses unsafe choices.

Selection is validated once, at startup, so a misconfigured deployment fails
with a sentence that says what to set -- not with a mysterious 502 on the first
request. The rules are policy, written down:

- `DEMO_MODE=true` always means the synthetic provider. Setting
  `MARKET_DATA_PROVIDER` to anything else alongside it is a contradiction and
  is refused rather than resolved silently.
- `APP_ENV=production` refuses `yfinance`: its data is not licensed for public
  display (PROVIDERS.md). A public deployment runs the demo or a provider whose
  terms permit display -- never the unofficial client.
- A provider that needs credentials reports which variable is missing, by
  name, never by value.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import lru_cache

from app.config import Settings, get_settings
from app.services.providers import demo, yahoo
from app.services.providers.prices import PriceProvider


class ProviderConfigurationError(RuntimeError):
    """Raised at startup for an invalid or unsafe provider selection."""


# Name -> factory. Adding a licensed provider means one entry here plus its
# adapter module; nothing in analytics, routes, or the frontend changes.
PROVIDER_FACTORIES: dict[str, Callable[[Settings], PriceProvider]] = {
    "demo": lambda _settings: demo.DemoPriceProvider(),
    "yfinance": lambda _settings: yahoo.YFinancePriceProvider(),
}

DEMO_PROVIDER = "demo"
DEFAULT_LOCAL_PROVIDER = "yfinance"


def resolve_provider_name(settings: Settings) -> str:
    requested = settings.market_data_provider
    if settings.demo_mode:
        if requested and requested != DEMO_PROVIDER:
            raise ProviderConfigurationError(
                f"DEMO_MODE=true conflicts with MARKET_DATA_PROVIDER={requested!r}. The public "
                "demo serves only the synthetic dataset; unset one of the two."
            )
        return DEMO_PROVIDER
    name = requested or DEFAULT_LOCAL_PROVIDER
    if name not in PROVIDER_FACTORIES:
        known = ", ".join(sorted(PROVIDER_FACTORIES))
        raise ProviderConfigurationError(
            f"Unknown MARKET_DATA_PROVIDER={name!r}. Known providers: {known}."
        )
    if settings.is_production and name == DEFAULT_LOCAL_PROVIDER:
        raise ProviderConfigurationError(
            "MARKET_DATA_PROVIDER=yfinance is refused when APP_ENV=production: yfinance data "
            "is not licensed for public display (see PROVIDERS.md). Set DEMO_MODE=true for "
            "the synthetic demo or configure a provider whose terms permit display."
        )
    return name


def build_price_provider(settings: Settings) -> PriceProvider:
    return PROVIDER_FACTORIES[resolve_provider_name(settings)](settings)


@lru_cache(maxsize=1)
def get_price_provider() -> PriceProvider:
    return build_price_provider(get_settings())


def reset_price_provider() -> None:
    """Test helper: forget the cached selection so new settings take effect."""
    get_price_provider.cache_clear()
