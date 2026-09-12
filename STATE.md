# State

**Updated:** 2026-09-12 · **Commit:** `a411756` · **Cycle:** 9

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
- CI: lint, typecheck, unit tests, build, browser smoke suite, and a secret-scan job
- **22 automated accessibility checks** over every panel, including empty and
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

- **Recent searches persist** (cycle 9): ticker + company name only, bounded at 8,
  newest first, validated on read; survives navigation and reload; typos never enter.
- **First-run onboarding**: Dashboard tool guide (each page named by the question it
  answers, why nothing predicts, where the data comes from); Learn philosophy note;
  inline glossary tips in the portfolio statistics table.
- **Page audit fixes**: nav wraps at narrow widths (Portfolio/Learn were off-screen at
  390px); Compare no longer scrolls the page sideways at 390px; zero excess return in
  the backtest is neutral; 404s tell the user to check spelling or search by name;
  news disclaimer disowns ratings/forecasts inside headlines.
- **API hardening pinned**: 28 malformed requests across every route must return 4xx
  with a plain detail and no traceback; providers stubbed to raise if reached.
- **Browser smoke suite** (Playwright, fixture-mocked API, desktop + 390px, in CI):
  orientation, nav visibility, deep links, recent-search persistence, unknown ticker,
  patterns language, compare, portfolio, learn, explore, theme persistence. Opt-in
  `@live` test via `E2E_LIVE=1`.
- **Provider documentation**: per-provider freshness, limits, cache windows, failure
  codes, licensing, and deployment status in the readme.

**Baseline metrics:** `METRICS.json` (424 backend tests, 244 frontend unit, 22 browser
smoke, 0 failing; npm audit 0 across all groups; Lighthouse a11y/best-practices/SEO
100/100/100 on the production build).

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

1. Replace the price-history provider with a licensed feed behind the existing
   provider interface (T-3) -- the only path to a public deployment. Nothing
   else on this list unblocks publishing.
2. Remaining Phase 8 detectors (gap detection, support/resistance) under the
   same anti-lookahead test regime as the ten shipped patterns.
3. An opt-in, scheduled live-provider run of the browser smoke suite
   (`E2E_LIVE=1`) outside CI, so provider drift is noticed without making CI
   depend on market data.

## Cold-start checklist for the next session

```bash
cd backend && source .venv/bin/activate && ruff check . && pytest   # expect 424 passed
cd frontend && npm run typecheck && npm run lint && npm test        # expect 244 passed
cd frontend && npm run test:e2e                                      # expect 22 passed, 2 skipped
```
Stop dev servers before running tests (T-5 — now also guarded by a 20s
`testTimeout`, so a missed step produces a slow run rather than a false red).
Read `TENSIONS.md` before planning. `personal.md` holds local setup notes and is
gitignored — never commit it.
