"""Shared test fixtures.

Every piece of process-global state the app keeps is reset before each test.
There are three: the quote/profile caches, the market-data cache, and the rate
limiter. All are in-process by design (see the notes in each module), which
makes them fast in production and stateful across tests.

The rate limiter is the one that bites. It counts requests per client, and
`TestClient` presents as a single client, so without a reset the count carries
across every test that touches the shared app. Once the suite grows past the
per-minute limit, tests begin failing on ordering alone -- passing in isolation,
failing in the suite. That is exactly the flaky verification signal CHANGELOG
SM-2 was written to stop, so it is reset centrally rather than worked around in
whichever file happens to trip it.
"""

from __future__ import annotations

import pytest

from app.middleware.rate_limit import reset_rate_limits
from app.services.market import clear_cache
from app.services.market_data import clear_caches


@pytest.fixture(autouse=True)
def _isolate_global_state() -> None:
    clear_caches()
    clear_cache()
    reset_rate_limits()
