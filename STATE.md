# State

**Updated:** 2026-08-31 · **Commit:** `a7e5ca5` · **Cycle:** 7

## Objective

Turn Stock Predictor into a production-quality, publicly publishable educational
investing platform. Full procedure in `CLAUDE.md`.

## Where the project actually is

A working full-stack app. Real market data end to end, no fabricated values
anywhere.

```
frontend/ React 19 + TS strict + Vite      backend/ FastAPI + Python 3.11+
  styles/      design tokens, light+dark     app/analytics/  indicators, risk,
  components/  UI primitives                                 interpretation, backtest
  features/    quote, chart, analysis,       app/services/   market data + providers
               education, market, search,    app/routes/     HTTP layer
               backtest, simulation,         app/middleware/ rate limiting
               watchlist
  hooks/ lib/ types/
```

**Working and verified:**
- Price history, charts with indicator overlays, CSV export
- 11 technical indicators + risk statistics, all unit-tested against
  hand-computed values
- Evidence-based interpretation: bull/bear observations, conflicts surfaced,
  per-indicator caveats, no buy/sell verdicts
- Live movers, sector heatmap, market session status, company news, ticker
  autocomplete (Finnhub + FMP, live keys verified)
- Capability gating: unavailable features explain themselves rather than faking
- **Walk-forward backtesting** of four indicator rules, with structural guards
  against lookahead, missing costs, no benchmark, in-sample fitting, and
  multiple testing — each pinned by a test
- **Backtest UI**, opt-in per ticker, showing the in-sample → out-of-sample drop
- **Dispersion simulation** (T-6), opt-in, drawn as a box plot rather than a
  path fan so it cannot be read as a forecast; names inherited drift explicitly
- **Correlation matrix** endpoint + panel (T-6)
- **Beta / alpha / R²** against SPY in the risk payload, with R² shown beside
  beta and a plain-English warning when the relationship is weak (T-6)
- **Expected shortfall** surfaced alongside VaR
- **Watchlist**, persisted locally through a validated storage layer
- CI: lint, typecheck, tests, build, and a secret-scan job
- **18 automated accessibility checks** over every panel, including empty and
  error states
- **Company profile panel** and **momentum indicator** with watchlist ranking
- **Hypothetical portfolio simulator** (FA7): fixed-weight replay with monthly
  contributions vs identical cash flows into SPY; statistics on flow-adjusted
  (time-weighted) returns so deposits never read as gains or hide drawdowns
- **Security comparison** (FA6): 2-6 tickers over one window, same method,
  nulls never zeros, correlation matrix alongside, no ranking
- **Multi-page shell**: dependency-free hash router; Dashboard / Analyze /
  Explore / Compare / Portfolio / Learn; deep links (#/analyze/AAPL),
  back/forward, aria-current, focus moved to main on navigation
- **Explore (FA10)**: transparent preference matching over a disclosed 20-ETF
  universe; tercile-based checks with the measurement on every criterion;
  losers returned, never hidden; category performance strip labeled with
  window and bar frequency

**Baseline metrics:** `METRICS.json` (369 backend tests, 206 frontend, 0 failing).

## Blocked / needs your decision

1. **T-2** — `backend/venv/` (a stale Windows virtualenv) should be deleted;
   awaiting your OK since it is your file.
2. **T-4** — stock screener needs a paid FMP plan.
3. **Rotate the FMP key.** Not a repository problem — the repo is clean and
   always was — but that key was printed to a terminal by httpx before the
   log-level fix. Details in `personal.md`.

T-1 and T-6 are **resolved**. T-5 is resolved by a config change rather than a
standing manual step.

## Next highest-value actions (unblocked, in order)

1. Phase-8 historical pattern detection (crossovers, volatility regimes,
   drawdown recoveries) as HISTORICAL observations with detection dates,
   sample sizes, and limitations -- never as predictions. Write the
   adversarial tests first (tiny samples must say so; no lookahead in
   detection dates).
2. Per-ticker recent-searches persistence across navigations (page-local
   state resets when leaving Analyze).
3. Landing/onboarding polish: a guided first-run tour of the tools.
4. Consider replacing the price-history provider before public deployment
   (T-3).

## Cold-start checklist for the next session

```bash
cd backend && source .venv/bin/activate && ruff check . && pytest   # expect 369 passed
cd frontend && npm run typecheck && npm run lint && npm test        # expect 206 passed
```
Stop dev servers before running tests (T-5 — now also guarded by a 20s
`testTimeout`, so a missed step produces a slow run rather than a false red).
Read `TENSIONS.md` before planning. `personal.md` holds local setup notes and is
gitignored — never commit it.
