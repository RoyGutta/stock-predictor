# Implementation Roadmap

Living document. Updated as milestones land.

**Last updated:** 2026-08-04
**Current state:** 153 backend tests, 21 frontend tests, lint clean both sides, build passing.

---

## Done

| # | Milestone | Commit |
|---|---|---|
| 0 | Repository audit ([AUDIT.md](AUDIT.md)) | — |
| 1 | Repository hygiene & safety baseline | `ee69444` |
| 2 | Secure, cached, tested market data API | `98ccee7` |
| 3 | Frontend API + indicator layers | `e268d53` |
| 4 | Indicator & risk engines | `c81ad2d` |
| 5 | Analysis endpoint with interpretation | `6b2c627` |

### What that covers, by phase

- **Phase 0** — complete.
- **Phase 1** — partial. Services/API/types layers exist; strict TS was already on.
  `App.tsx` still holds all UI; feature-folder split is pending.
- **Phase 2** — complete. `.gitignore`, `.env.example`, gitignored `personal.md`,
  MIT licence with disclaimer, CORS allowlist, input validation, opaque errors,
  rate limiting. No secrets have ever been committed.
- **Phase 8** — mostly done. SMA, EMA, VWAP, RSI, MACD, Stochastic, ATR, Bollinger,
  ADX (+DI/−DI), OBV, Ichimoku. Missing: Volume Profile, support/resistance,
  candlestick patterns, gap detection.
- **Phase 9** — foundation done, deterministic. Evidence grouped bull/bear/neutral,
  conflicts surfaced, per-indicator caveats, agreement score explicitly not a
  probability, no buy/sell output. LLM prose layer not started.
- **Phase 10** — partial. Volatility, drawdown with recovery dates, VaR, CVaR,
  Sharpe, Sortino, beta/alpha with R², correlation, Monte Carlo. Not yet surfaced
  in the UI; no sector exposure or stress testing.
- **Phase 19** — partial. 174 unit/integration tests. No component or E2E tests.
- **Phase 20** — partial. README, AUDIT, personal.md, auto-generated OpenAPI docs.

---

## Next

Ordered by leverage, not by phase number.

### 1. Surface the analytics in the UI
The analysis endpoint returns far more than the app displays. Highest value per
unit of work — the hard part is already built and tested.

### 2. Phase 3 — design system
Replace inline styles with tokens (colour, spacing, type scale), proper light/dark,
responsive layout, focus states. Currently every value is a magic number at its
use site, and the app is unusable below ~900 px.

### 3. Phase 4 — beginner onboarding
Glossary and explainers: what an ETF is, diversification, market cap, volatility,
risk, compounding. The interpretation layer already writes plain-English text —
this extends the same voice.

### 4. Phase 1 completion — feature folders
Split `App.tsx` (currently ~450 lines) into feature folders with reusable components.

### 5. Phase 7/11/12/17 — provider integration
Blocked on free-tier keys (Finnhub + FMP). Build the provider interface and the
implementations; features show a "requires a provider key" state rather than fake
data.

### 6. Phases 5/6/14/15/16 — persistence
Database, auth, portfolio builder, watchlists, paper trading. Largest single chunk;
everything here depends on a persistence layer that does not exist yet.

---

## Standing constraints

These are not negotiable and shape every decision above.

1. **No fabricated market data.** If a provider is unavailable, the app says so.
   Nothing is stubbed with plausible-looking numbers.
2. **No predictions.** Indicators describe the past. Monte Carlo is labelled as
   dispersion under an explicitly-stated assumption, not a forecast.
3. **No buy/sell verdicts.** Evidence is shown on both sides; conflicts are
   surfaced rather than averaged into a score.
4. **Every statistic states its basis.** Window, frequency, and observation count
   travel with the number.
5. **Absent statistics are null, never zero.** A missing Sharpe ratio is `null`,
   not `0.0` — the latter reads as a real, bad value.

---

## Known gaps

- `yfinance` is unlicensed for redistribution. Fine locally; must be replaced
  before any public deployment. Tracked in `personal.md`.
- The in-process cache and rate limiter are per-worker. Multi-instance deployment
  needs Redis (`REDIS_URL` is already in `.env.example`).
- `html2canvas` is unmaintained and mis-renders modern CSS colour functions.
  Replace with `html-to-image` when the design system lands.
- Frontend bundle is 527 kB (161 kB gzip), dominated by Recharts. Needs route-level
  code splitting once there is more than one route.
- No CI workflow yet.
