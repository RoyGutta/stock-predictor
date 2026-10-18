"""SEC fair-access behavior: declared agent, spacing, caching, stale fallback, errors."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import httpx
import pytest

from app.config import get_settings, sec_user_agent_problem
from app.services.providers.base import (
    ProviderError,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderUnavailable,
)
from app.services.sec.client import (
    TICKERS_URL,
    SecClient,
    SecNotConfigured,
    SecNotFound,
    SecRejected,
)
from tests.sec_fixtures import TEST_AGENT, TICKER_MAP, Recorder, json_response, make_client

URL = "https://data.sec.gov/submissions/CIK0000320193.json"


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


def run(coro):
    return asyncio.run(coro)


# --- declared user agent -----------------------------------------------------


@pytest.mark.parametrize(
    ("value", "ok"),
    [
        ("", False),
        ("Stock Predictor", False),
        ("ops@stockpredictor.dev", False),
        ("Jane Doe jane@example.com", False),
        ("Stock Predictor ops@stockpredictor.dev", True),
        ("Jane Doe <jane.doe@university.edu>", True),
    ],
)
def test_user_agent_requires_name_and_real_contact(value, ok):
    assert (sec_user_agent_problem(value) is None) is ok


def test_no_request_is_made_without_a_valid_agent():
    recorder = Recorder({URL: lambda _r: json_response({})})
    client = make_client(recorder, agent="")
    with pytest.raises(SecNotConfigured) as info:
        run(client.get(URL, ttl=60))
    assert info.value.status_code == 503 and recorder.requests == []
    assert "SEC_USER_AGENT" in str(info.value)


def test_every_request_declares_the_configured_agent():
    recorder = Recorder({URL: lambda _r: json_response({"ok": 1})})
    run(make_client(recorder).get(URL, ttl=60))
    request = recorder.requests[0]
    assert request.headers["User-Agent"] == TEST_AGENT
    assert "gzip" in request.headers["Accept-Encoding"]


# --- rate spacing and request economy ----------------------------------------


def test_requests_are_spaced_at_the_configured_rate():
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    recorder = Recorder({f"{URL}?n={i}": (lambda _r: json_response({})) for i in range(3)})
    settings = replace(get_settings(), sec_user_agent=TEST_AGENT, sec_max_requests_per_second=4)
    # A frozen monotonic clock: three requests issued at the same instant.
    client = SecClient(settings, transport=httpx.MockTransport(recorder),
                       monotonic=lambda: 0.0, sleep=record)

    async def go():
        for i in range(3):
            await client.get(f"{URL}?n={i}", ttl=60)

    run(go())
    assert waits == pytest.approx([0.25, 0.5])


def test_cache_serves_repeat_requests_within_ttl():
    clock = Clock()
    recorder = Recorder({URL: lambda _r: json_response({"v": 1})})
    client = make_client(recorder, clock=clock)
    run(client.get(URL, ttl=600))
    clock.now += 599
    run(client.get(URL, ttl=600))
    assert recorder.count("CIK0000320193") == 1
    clock.now += 2
    run(client.get(URL, ttl=600))
    assert recorder.count("CIK0000320193") == 2


def test_concurrent_requests_for_one_url_share_one_upstream_call():
    recorder = Recorder({URL: lambda _r: json_response({"v": 1})})
    client = make_client(recorder)

    async def go():
        await asyncio.gather(*(client.get(URL, ttl=600) for _ in range(5)))

    run(go())
    assert recorder.count("CIK0000320193") == 1


def test_transform_runs_before_caching():
    recorder = Recorder({URL: lambda _r: json_response({"big": list(range(10)), "keep": 7})})
    result = run(make_client(recorder).get(URL, ttl=60, transform=lambda raw: raw["keep"]))
    assert result.data == 7


# --- validators --------------------------------------------------------------


def test_last_modified_is_revalidated_and_304_refreshes_the_entry():
    clock = Clock()
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("If-Modified-Since"))
        if request.headers.get("If-Modified-Since"):
            return httpx.Response(304)
        return json_response(
            TICKER_MAP, headers={"Last-Modified": "Fri, 16 Oct 2026 11:54:03 GMT"}
        )

    client = make_client(Recorder({TICKERS_URL: handler}), clock=clock)
    first = run(client.get(TICKERS_URL, ttl=10))
    clock.now += 11
    second = run(client.get(TICKERS_URL, ttl=10))
    assert seen == [None, "Fri, 16 Oct 2026 11:54:03 GMT"]
    assert second.data == first.data and second.stale is False
    assert second.retrieved_at > first.retrieved_at


# --- failure handling ----------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "error"),
    [(429, ProviderRateLimited), (500, ProviderUnavailable), (503, ProviderUnavailable),
     (403, SecRejected), (418, ProviderError)],
)
def test_upstream_errors_map_to_typed_errors(status, error):
    client = make_client(Recorder({URL: lambda _r: httpx.Response(status)}))
    with pytest.raises(error):
        run(client.get(URL, ttl=60))


def test_timeout_and_transport_errors_are_typed():
    def timeout(_r):
        raise httpx.ReadTimeout("slow")

    def broken(_r):
        raise httpx.ConnectError("down")

    with pytest.raises(ProviderTimeout):
        run(make_client(Recorder({URL: timeout})).get(URL, ttl=60))
    with pytest.raises(ProviderUnavailable):
        run(make_client(Recorder({URL: broken})).get(URL, ttl=60))


def test_malformed_json_and_failed_transform_are_errors_not_crashes():
    bad_json = Recorder({URL: lambda _r: httpx.Response(200, content=b"<html>")})
    with pytest.raises(ProviderError, match="malformed"):
        run(make_client(bad_json).get(URL, ttl=60))
    wrong_shape = Recorder({URL: lambda _r: json_response({"unexpected": True})})
    with pytest.raises(ProviderError, match="malformed"):
        run(make_client(wrong_shape).get(URL, ttl=60, transform=lambda raw: raw["filings"]))


def test_404_is_definitive_and_cached_without_stale_fallback():
    recorder = Recorder({})
    client = make_client(recorder, clock=Clock())
    for _ in range(2):
        with pytest.raises(SecNotFound):
            run(client.get(URL, ttl=600))
    assert len(recorder.requests) == 1


def test_stale_copy_is_served_and_flagged_when_sec_fails():
    clock = Clock()
    state = {"fail": False}

    def handler(_r):
        return httpx.Response(429) if state["fail"] else json_response({"v": 1})

    client = make_client(Recorder({URL: handler}), clock=clock)
    fresh = run(client.get(URL, ttl=60))
    state["fail"] = True
    clock.now += 120
    stale = run(client.get(URL, ttl=60))
    assert stale.stale is True and stale.data == {"v": 1}
    assert "rate limit" in stale.stale_reason
    assert stale.retrieved_at == fresh.retrieved_at


def test_stale_copy_older_than_the_limit_is_not_served():
    clock = Clock()
    state = {"fail": False}

    def handler(_r):
        return httpx.Response(503) if state["fail"] else json_response({"v": 1})

    client = make_client(Recorder({URL: handler}), clock=clock, sec_stale_max_age=3600)
    run(client.get(URL, ttl=60))
    state["fail"] = True
    clock.now += 3601
    with pytest.raises(ProviderUnavailable):
        run(client.get(URL, ttl=60))


def test_no_retries_one_failure_is_one_request():
    recorder = Recorder({URL: lambda _r: httpx.Response(503)})
    with pytest.raises(ProviderUnavailable):
        run(make_client(recorder).get(URL, ttl=60))
    assert len(recorder.requests) == 1


def test_request_rate_above_sec_limit_is_refused_at_startup():
    with pytest.raises(RuntimeError, match="10 requests per second"):
        replace(get_settings(), sec_max_requests_per_second=10).validate()
