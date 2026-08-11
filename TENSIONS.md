# Tensions

Unresolved problems, contradictions, and things I suspect are wrong but have not
fixed. This file is the honesty log. It never gets emptied to look productive.

---

## T-1 — Success metric conflicted with the product (RESOLVED 2026-08-11)

**Resolved as option C.** Delegated to me and decided: backtest indicator rules
as history, never as strategy.

`app/analytics/backtest.py` walk-forward validates four rules — parameters chosen
on an earlier slice, evaluated once on a held-out later slice. That produces
genuine out-of-sample numbers while the app still never predicts a price.

Option B (a real forecaster) was rejected: retail-grade price prediction is not
reliably better than chance, and shipping one would contradict the product's
entire position even behind a research flag.

**A caveat that matters and is recorded in METRICS.json:** the backtest *return*
figures are facts about the market, not about this system. Treating them as a
number to improve would mean tuning rules until they look good — the exact data
mining the engine exists to expose. What is tracked as our metric is the
*validity* of the measurement (no lookahead, costs charged, benchmark compared,
slice genuinely held out, all results reported), each enforced by a test.

---

## T-2 — `backend/venv/` was corrupted by a scripted edit (OPEN, low impact)

While normalizing British→US spelling, my file-walk skip list contained `.venv`
but not `venv`. The script rewrote comments and docstrings in roughly 120
third-party files inside `backend/venv/Lib/site-packages/`.

Impact is contained:
- That directory is a **Windows** virtualenv (`home = C:\Users\Roy\...`, `Lib/`
  and `Scripts/` layout, no `bin/`). It cannot run on this macOS machine.
- It is gitignored and has never been tracked.
- The environment actually in use is `backend/.venv/`, which was untouched.
- It is regenerable in seconds on Windows:
  `python -m venv venv && venv\Scripts\pip install -r requirements.txt`

**Recommended fix: delete `backend/venv/`.** I have not done so without your
say-so because it is your file. Not urgent, but it is dead weight and now dirty.

**Process fix already applied:** scripted edits now enumerate explicit source
roots instead of walking the tree. See CHANGELOG SM-1.

---

## T-3 — `yfinance` is not licensed for redistribution (OPEN, blocks public deploy)

Price history comes from `yfinance`, an unofficial scraper of Yahoo Finance. It
is fine for local and educational use but is **not licensed for commercial use or
data redistribution**.

This is a legal ceiling, not a technical one, and it blocks any genuinely public
deployment. The provider layer is already abstracted so a licensed source can be
swapped in without touching the routes.

---

## T-4 — Phase 11 (stock screener) is not buildable on the current plan (OPEN)

FMP returns HTTP 402 for `company-screener` and `stock-list`. Verified against
the live key on 2026-08-05, not assumed from documentation.

The feature is reported as unavailable through `/api/v1/market/capabilities` and
the UI explains why. It is **not** stubbed with invented rows.

Unblocking needs either a paid FMP plan or a provider whose free tier includes
screening.

---

## T-5 — Test suite is sensitive to machine load (OPEN, low)

Frontend component tests timed out at the default 5 s while dev servers and a
Playwright browser were running, producing inconsistent results between runs
(1 failure, then 4, then 0). The tests themselves execute in ~1.0 s.

Not a code defect, but a flaky signal. Either raise `testTimeout` or make it
routine to stop background servers before a verification run. Currently handled
by the latter (see CHANGELOG SM-1).

---

## T-6 — Analytics computed but unreachable from the UI (OPEN, low)

`monte_carlo`, `conditional_value_at_risk`, `beta_alpha`, and
`correlation_matrix` are implemented and tested in `app/analytics/risk.py`, but
nothing consumes them. Same for `GET /api/v1/market/profile/{ticker}`.

Not dead code — they are tested and reachable via the API — but they deliver no
user value yet.
