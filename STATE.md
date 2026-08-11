# State

**Updated:** 2026-08-11 · **Commit:** `pending` · **Cycle:** 3

## Objective

Turn Stock Predictor into a production-quality, publicly publishable educational
investing platform. Full procedure in `CLAUDE.md`.

## Where the project actually is

A working full-stack app. Real market data end to end, no fabricated values
anywhere.

```
frontend/ React 19 + TS strict + Vite      backend/ FastAPI + Python 3.11+
  styles/      design tokens, light+dark     app/analytics/  indicators, risk, interpretation
  components/  UI primitives                 app/services/   market data + providers
  features/    quote, chart, analysis,       app/routes/     HTTP layer
               education, market, search     app/middleware/ rate limiting
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
- CI: lint, typecheck, tests, build, and a secret-scan job
- **Walk-forward backtesting** of four indicator rules, with structural guards
  against lookahead, missing costs, no benchmark, in-sample fitting, and
  multiple testing — each pinned by a test
- **Backtest UI**, opt-in per ticker, showing the in-sample → out-of-sample drop
  as the primary visual. Verified on AAPL 1Y: 0 of 3 rules beat buy-and-hold

**Baseline metrics:** `METRICS.json` (247 backend tests, 76 frontend, 0 failing).

## Blocked / needs your decision

1. **T-2** — `backend/venv/` (a stale Windows virtualenv) should be deleted;
   awaiting your OK since it is your file.
2. **T-4** — stock screener needs a paid FMP plan.

T-1 is **resolved**: the success metric is now measurable via walk-forward
backtesting rather than a price forecaster.

## Next highest-value actions (unblocked, in order)

1. Automated accessibility tests (`vitest-axe`) — the UI is currently only
   checked by hand each milestone.
2. Surface Monte Carlo, CVaR, beta, and correlation in the UI (T-6).
3. Company profile panel — the endpoint exists and nothing consumes it.
4. Complete Phase 8: support/resistance, gap detection, candlestick patterns.
5. Component tests for BacktestPanel — its zero-return and never-traded states
   were both found by eye, not by a test.

## Cold-start checklist for the next session

```bash
cd backend && source .venv/bin/activate && ruff check . && pytest      # expect 247 passed
cd frontend && npm run typecheck && npm run lint && npm test          # expect 76 passed
```
Stop dev servers before running tests (T-5). Read `TENSIONS.md` before planning.
`personal.md` holds local setup notes and is gitignored — never commit it.
