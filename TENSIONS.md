# Tensions

Unresolved problems, contradictions, and things I suspect are wrong but have not
fixed. This file is the honesty log. It never gets emptied to look productive.

---

## T-1 — The stated success metric cannot currently be measured (OPEN, needs your call)

**Severity: high. This one blocks the mission statement itself.**

The operating procedure names the success metric as *"validated out-of-sample
performance"*, and the primary objective includes *"ML prediction"* and
*"backtesting"*.

But this project has no predictive model, and that is deliberate:

- Your earlier standing instruction was *"do not generate fake financial data or
  'AI predictions'"*.
- The whole product position — documented in `readme.md`, enforced in
  `app/analytics/interpretation.py`, and pinned by tests that assert the API
  never emits buy/sell language — is that this tool **describes the past and
  does not forecast**.
- `backend/app/ml/predictor.py` and `risk_analysis.py` are empty files inherited
  from the original repo. Nothing has ever been implemented there.

So "out-of-sample predictive performance" has no baseline, and creating one means
building the forecasting model the project currently, intentionally, refuses to
build.

These two instructions genuinely conflict. I have not resolved it unilaterally
because it is a product decision, not an engineering one.

**Options:**

| # | Path | Consequence |
|---|---|---|
| A | Keep the no-prediction stance. Redefine the success metric around reliability, correctness, and coverage — which is what `METRICS.json` currently tracks. | Honest, publishable, consistent with the existing product. Does not satisfy the literal "ML prediction / out-of-sample" wording. |
| B | Build a genuinely validated forecasting model — walk-forward splits, no lookahead leakage, benchmarked against a naive baseline, and reported with confidence intervals and a plain statement that it is usually no better than random. | Satisfies the objective literally. Substantial work. Must never be surfaced as a buy/sell signal. |
| C | Build backtesting *without* prediction: evaluate how classic indicator rules would have performed historically, presented as history, not as a strategy recommendation. | Genuinely educational, honest, and a real use of "backtesting". Middle path. |

**My recommendation: C, then optionally B behind an explicit research flag.**
C gives real, measurable out-of-sample numbers (a rule tested on data it was not
tuned on) without the app ever claiming to predict a price. B is defensible only
if its output is framed as a research artifact, since retail-grade price
forecasting is not reliably better than chance and presenting it otherwise is the
exact failure mode this project was built to avoid.

**Status: awaiting your decision. No forecasting code will be written until then.**

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
