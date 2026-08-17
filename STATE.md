# State

**Updated:** 2026-08-17 · **Commit:** `pending` · **Cycle:** 4

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
- **14 automated accessibility checks** over every panel, including empty and
  error states

**Baseline metrics:** `METRICS.json` (278 backend tests, 151 frontend, 0 failing).

## Blocked / needs your decision

1. **T-2** — `backend/venv/` (a stale Windows virtualenv) should be deleted;
   awaiting your OK since it is your file.
2. **T-4** — stock screener needs a paid FMP plan.
3. **T-7** — a price forecaster was requested in a later brief, which reverses
   the T-1 decision. Not built. See `TENSIONS.md`; this needs your explicit call.
4. **Rotate the FMP key.** Not a repository problem — the repo is clean and
   always was — but that key was printed to a terminal by httpx before the
   log-level fix. Details in `personal.md`.

T-1 and T-6 are **resolved**. T-5 is resolved by a config change rather than a
standing manual step.

## Next highest-value actions (unblocked, in order)

1. Company profile panel — `GET /market/profile/{ticker}` exists and nothing
   consumes it. Smallest remaining gap between built and reachable.
2. Paper-trading portfolio, on the existing storage layer. Largest single
   feature still unbuilt that needs no new provider.
3. Complete Phase 8: support/resistance, gap detection, candlestick patterns —
   all computable from data already fetched.
4. Stock comparison view, consuming the correlation endpoint for a basket.
5. Multi-page routing. `App.tsx` is ~320 lines and holds every panel; it is the
   next thing to become unwieldy, though it is not painful yet.

## Cold-start checklist for the next session

```bash
cd backend && source .venv/bin/activate && ruff check . && pytest   # expect 278 passed
cd frontend && npm run typecheck && npm run lint && npm test        # expect 151 passed
```
Stop dev servers before running tests (T-5 — now also guarded by a 20s
`testTimeout`, so a missed step produces a slow run rather than a false red).
Read `TENSIONS.md` before planning. `personal.md` holds local setup notes and is
gitignored — never commit it.
