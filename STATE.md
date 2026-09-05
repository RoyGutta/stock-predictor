# State

**Updated:** 2026-09-04 · **Commit:** `323cd32` · **Cycle:** 8

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
- **Historical pattern detection (Phase 8)**: ten technical events (MA
  crossovers, RSI extremes, MACD crossings, Bollinger breaks, outsized moves,
  drawdown recoveries) detected using only bars at or before each event's own
  date. The guarantee is a tested property: two future-mutation tests assert
  detections at or before a cutoff are byte-identical after every later bar is
  multiplied x5 or x0.2. Outcomes over the next 5/20/60 bars describe history
  only; boundary events excluded and counted; N=0 is null; N<10 flagged.
  Opt-in panel on Analyze: occurrence counts, sample-size-first outcome
  tables, filterable most-recent-first timeline, method + disclaimer callout.

**Baseline metrics:** `METRICS.json` (395 backend tests, 217 frontend, 0 failing).

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

1. Learn-section expansion: glossary entries for expense ratios, dividends,
   bonds/treasuries, index funds, survivorship bias, overfitting, and
   lookahead bias (Phase 6 topics not yet covered).
2. Per-ticker recent-searches persistence across navigations (page-local
   state resets when leaving Analyze).
3. Landing/onboarding polish: a guided first-run tour of the tools.
4. Consider replacing the price-history provider before public deployment
   (T-3).

## Cold-start checklist for the next session

```bash
cd backend && source .venv/bin/activate && ruff check . && pytest   # expect 395 passed
cd frontend && npm run typecheck && npm run lint && npm test        # expect 217 passed
```
Stop dev servers before running tests (T-5 — now also guarded by a 20s
`testTimeout`, so a missed step produces a slow run rather than a false red).
Read `TENSIONS.md` before planning. `personal.md` holds local setup notes and is
gitignored — never commit it.
