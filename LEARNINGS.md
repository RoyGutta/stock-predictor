# Learnings

Append-only. Each entry: what was tried, what happened, what changes as a result.
Only durable lessons belong here — not a work log.

---

## L-1 · Probe provider APIs before writing against their docs
**2026-08-05**

FMP's documentation still describes `/api/v3`. Keys issued now get HTTP 403 with
a "Legacy Endpoint" body on every one of those paths. The working API is
`/stable`, and `company-screener` is paid-only (HTTP 402) regardless.

Ten minutes of probing every endpoint with the real key mapped the free tier
exactly and prevented building a screener UI against an endpoint that can never
respond.

**Applies from now on:** before integrating any external API, enumerate the
endpoints with a live key and record what actually works in the module docstring
with the date verified.

---

## L-2 · HTTP clients log credentials by default
**2026-08-05**

`httpx` logs every request at INFO as a full URL — including the query string,
which is where API keys live. Simply running the app wrote a live key into the
terminal.

Worse: suppressing it in `main.py` was not enough. Tests import the provider
module directly without importing `main`, so the leak persisted there. The fix
belongs in the module that makes the requests.

**Applies from now on:** silence third-party request logging in the module that
owns the client, not the app entry point, and assert the secret never reaches
`caplog` in a test.

---

## L-3 · Real data exposes product problems that mock data hides
**2026-08-05**

The first live pull of "top gainers" returned +801%, +97%, +84% — all sub-$5
microcaps, the exact securities most targeted by pump-and-dump promotion.

Mock data would have shown tidy 3% moves and the risk would never have surfaced.
The result was a `low_priced` flag against the SEC's $5 threshold plus a
disclaimer naming the risk. Flagged rather than filtered: removing those rows
would misreport what the day's actual biggest movers were.

**Applies from now on:** view every new data feed with real values before
designing its UI, and ask what a beginner would wrongly conclude from it.

---

## L-4 · Scripted edits need explicit roots, never a tree walk
**2026-08-10**

A spelling-normalization script used `rglob("*")` with a skip list containing
`.venv` but not `venv`. It rewrote ~120 files inside a stale Windows virtualenv
before crashing on a non-UTF-8 file.

Contained (gitignored, unusable on this machine, separate from the active
`.venv/`) but avoidable.

**Applies from now on:** codemods enumerate explicit source roots
(`frontend/src`, `backend/app`, `backend/tests`) instead of walking from the
repository root. Recorded as CHANGELOG SM-1.

---

## L-5 · Tests are the right place to pin safety properties
**2026-08-04 → 2026-08-10**

Several genuine defects were caught by tests asserting a *property* rather than a
value:

- RSI returned 100 on a perfectly flat series (0 gains and 0 losses is 0/0, not
  saturation) — it was reporting maximum bullish momentum for a price that never
  moved.
- `max_drawdown` used label-based `.loc` and raised `TypeError` on a duplicated
  index, which real vendor data can contain.
- A `javascript:` URL from the news feed would have reached an `href`.

Each is now a named regression test. The value-level tests would not have found
any of them.

**Applies from now on:** for anything user-facing and safety-relevant, assert the
property ("output never contains advice language", "the key never reaches the
logs", "an absent statistic is null and not zero"), not just the expected value.

---

## L-6 · Stop background servers before a verification run
**2026-08-10**

Frontend component tests timed out at the 5 s default while Vite, uvicorn, and a
Playwright browser were running — producing 1, then 4, then 0 failures across
identical runs. The tests themselves take ~1.0 s.

An inconsistent test signal costs more time than the servers save.

**Applies from now on:** kill dev servers and browsers before the VERIFY step.

---

## L-7 · A backtest's value is in its guards, not its returns
**2026-08-11**

Writing the backtest engine, almost all the difficulty was in *not* producing a
flattering number. The five standard ways backtests lie — lookahead, no costs, no
benchmark, in-sample fitting, multiple testing — each needed an explicit
structural defense, and each is now a test.

The most effective was adversarial: give a strategy perfect foresight of a single
+100% bar and assert it captures **nothing**. That one test makes lookahead bias
impossible to reintroduce silently. A leakage test does the same for the
train/test split by tampering only with held-out data and asserting the chosen
parameter is unchanged.

The first run on real data immediately produced the honest result the design was
for: an RSI rule at +48% in-sample fell to +26.8% out-of-sample and lost to
buy-and-hold.

**Applies from now on:** when building anything that evaluates its own
performance, write the adversarial test first — the one that proves it *cannot*
cheat. A metric with no such guard should not be believed, including by me.
