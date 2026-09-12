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

---

## L-8 · Zero is not a positive number
**2026-08-11**

The backtest panel colored a 0.0% out-of-sample return green, using a
`>= 0 ? positive : negative` test. But that 0.0% meant the rule never triggered
and sat in cash — rendering it as a gain was actively misleading, and it sat
directly beneath a headline saying the rule had lost.

Both this and a nonsense "picked none = 0 from 1 tried" line on the benchmark row
were found by *looking at the rendered page*, not by any test. Types, lint, and 76
unit tests all passed.

**Applies from now on:** treat exact zero as its own case in any sign-based
formatting, and say what a zero means rather than leaving the reader to infer it.
More generally: rendering defects need eyes on the actual page — a green check
from the test suite does not mean the screen is correct.

---

## L-9 · A statistic's window is part of the statistic
**2026-08-17**

Two separate defects this cycle were the same mistake: a number rendered without
the window it was measured over.

- The watchlist showed "MSFT +25.22%" with nothing saying that was a month. A
  25% *daily* move for Microsoft is implausible enough to alarm someone, and
  "percent change" defaults to "today" in every reader's head.
- The dispersion simulation showed a median of $404 against a $306 price. That
  32% gap is inherited drift — resampling a window in which the stock rose
  carries that rise into every path — but on screen it reads as a forecast.

Both passed every test. Both were caught by looking at the page and asking what
a beginner would conclude, which is the L-3 question applied to a rendered
screen rather than to a new data feed.

The fix in each case was not to hide the number but to name its basis, which
constraint 12 already required of the API payload. The rule had been applied to
the JSON and not to the pixels.

**Applies from now on:** any figure whose meaning depends on a window carries
that window in the UI, not just in the payload. When a derived number differs
noticeably from the value a reader is anchored on, say why in words rather than
trusting a caption to carry it.

---

## L-10 · Config for an unbuilt feature is a lie with a long half-life
**2026-08-17**

`.env.example` documented `ANTHROPIC_API_KEY` as enabling AI explanations that
"fall back to deterministic template text" without it. There has never been an
LLM integration in this codebase. Every explanation is computed, always was, and
there is no fallback because there is nothing to fall back from.

Someone following that file adds a paid key and waits for prose that cannot
arrive. It also quietly contradicts the product's own position, since it implies
the app generates commentary it does not generate. Two more variables
(`ALPHA_VANTAGE_API_KEY`, `REDIS_URL`) were read by no code path either.

The check that found it was mechanical and took a minute: extract the variables
the code reads, extract the variables the file documents, diff both directions.
It also found two variables the code read that were documented nowhere.

**Applies from now on:** `.env.example` is a contract, not a wishlist. Diff it
against the variables the code actually reads, in both directions, whenever
either changes. Configuration for future features belongs in ROADMAP, where
being unbuilt is the point, not in a file whose entire purpose is telling
someone what to set up right now.

## L-11 · A verification command piped through grep cannot gate a commit

While landing the glossary additions, the browser suite was run as
`npx playwright test | grep ... | tail -3 && git commit`. Two tests failed --
the preview server was still serving the previous build -- but the pipeline's
exit status was `tail`'s, so `&&` saw success and the commit went through
before the check had actually passed. The commit was correct (the unit suite
had verified the change), but only by luck: the gate that was supposed to
catch a regression was decorative.

Two separate lessons. First, `set -o pipefail` or run the verifier un-piped
before any `&&` that has side effects; filter the output afterwards. Second,
a local E2E runner with `reuseExistingServer: true` verifies whatever build the
running server happens to hold -- kill the preview server (or rebuild) before
treating its result as evidence about the current tree.

**Applies from now on:** nothing that mutates state (commit, push, tag) goes
after a pipe. Verify, look at the exit code, then act.
