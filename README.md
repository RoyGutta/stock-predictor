# Stock Predictor

An educational market-analysis platform. It charts real historical prices, computes
standard technical indicators and risk statistics, detects well-known historical
patterns, runs walk-forward backtests of textbook trading rules, and replays
hypothetical portfolios through past data. Every figure describes what already
happened, with its window, frequency, and sample size stated.

The name is inherited. **The application does not predict prices, does not issue
buy or sell recommendations, and does not rank securities.** That refusal is the
product's central design decision, and the codebase enforces it with tests.

> Educational tool. Not investment advice. Market data may be delayed or
> incomplete. Investing involves risk, including loss of principal.

---

## Contents

- [What it does](#what-it-does)
- [What it deliberately does not do](#what-it-deliberately-does-not-do)
- [Screens](#screens)
- [Methodology](#methodology)
- [Architecture](#architecture)
- [API](#api)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Testing](#testing)
- [Data providers and licensing](#data-providers-and-licensing)
- [Deployment status](#deployment-status)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

| Area | Summary |
|---|---|
| Price history | Real OHLCV history for any listed US ticker over eight ranges, from one day of 5-minute bars to full monthly history, with CSV export |
| Technical indicators | SMA, EMA, VWAP, RSI, MACD, Stochastic, ATR, Bollinger Bands, ADX (+DI/-DI), OBV, Ichimoku; all computed server-side and unit-tested against hand-computed values |
| Evidence ledger | Observations grouped as bullish, bearish, and neutral, with each indicator's known failure mode attached; contradictions are reported, not averaged |
| Risk statistics | Annualized volatility, maximum drawdown with recovery dates, Sharpe, Sortino, historical VaR and expected shortfall, beta and alpha against SPY with R-squared |
| Historical patterns | Ten technical events (moving-average crossovers, RSI extremes, MACD crossings, Bollinger breaks, outsized single-bar moves, drawdown recoveries) with what followed each over 5, 20, and 60 bars |
| Walk-forward backtests | Four indicator rules tested on a held-out slice after parameter selection on an earlier slice, with transaction costs, a one-bar execution lag, and buy-and-hold beside every rule |
| Dispersion simulation | Bootstrapped resampling of a security's own past returns, drawn as a box plot so it reads as a range, not a path |
| Portfolio replay | Fixed-weight hypothetical portfolios with monthly contributions, replayed through real history against identical cash flows into an S&P 500 fund |
| Compare | Two to six securities over the identical window and method, with a return-correlation matrix; no ranking |
| Explore | Preference matching over a disclosed universe of 20 ETFs; every criterion shows the measurement behind it and funds that miss are shown, not hidden |
| Market context | Biggest movers (sub-$5 issues flagged, not filtered), sector snapshot, company profile, headlines, symbol search, session status |
| Learn | A 17-entry learning path drawn from a 30-term plain-English glossary; each entry ends with what the concept cannot tell you |

## What it deliberately does not do

- No price forecasts, targets, or probabilities that a security will rise or fall.
- No buy, sell, or hold verdicts. Evidence is shown on both sides.
- No "best" list. Compare and Explore describe differences; they do not rank.
- No optimization of historical parameters presented as a strategy. The backtest
  exists to show the in-sample to out-of-sample drop, not to find a winner.
- No fabricated data. A feature whose provider is unavailable says so.
- No zero where a value is missing. Absent statistics serialize as `null`.
- No hidden caveats. Every panel's limitations render alongside its numbers.

These are enforced by tests: the backtest cannot act on a signal in its own bar,
a perfect-foresight oracle captures nothing, pattern detection is byte-identical
after every future bar is mutated, deposits cannot appear as portfolio gains, and
recommendation language cannot render in the pattern or backtest panels.

## Screens

Six routes behind a dependency-free hash router (`#/dashboard`, `#/analyze/AAPL`,
`#/explore`, `#/compare`, `#/portfolio`, `#/learn`). Deep links, back and forward,
and refresh all land on the same state. Light and dark themes are both
first-class; layouts are verified at 1280 px and 390 px.

## Methodology

**Indicators.** Wilder smoothing (alpha = 1/period) for RSI, ATR, and ADX; standard
EMA elsewhere. Bars where an indicator is not yet defined serialize as `null`, so
charts draw a gap rather than a line to zero.

**Backtests** (`backend/app/analytics/backtest.py`). Positions take effect one bar
after their signal. A proportional cost (default 10 bps) is charged on every
position change. The parameter grid is searched on the first 60 percent of the
window and the chosen parameter is scored on the remaining 40 percent it never
saw. Buy-and-hold over the identical window is always reported. Every rule and
the number of settings it tried are returned, never just the winner. Guard tests:
an oracle with perfect foresight earns nothing under the lag; tampering with the
test slice does not change the chosen parameter.

**Historical patterns** (`backend/app/analytics/patterns.py`). Every event is
detected using only bars at or before its own date: rolling statistics trail,
and the volatility baseline for a bar ends one bar earlier. Outcome tables report
what actually followed each event; future bars describe history and never decide
detection. Events too close to the end of the data are excluded from a window and
the exclusion is counted. Zero-sample statistics are `null`; samples under ten
are labeled. Parameters are fixed conventional values and are not tuned to the
data. Two tests mutate every bar after a cutoff (x5 and x0.2) and assert the
detections at or before the cutoff are unchanged.

**Portfolio replay** (`backend/app/analytics/portfolio.py`). The initial amount is
invested at the first bar shared by every holding, split by target weight;
contributions are invested the same way at the first shared bar of each later
month. Holdings are never rebalanced, and the resulting drift is reported.
Statistics are computed on the flow-adjusted (time-weighted) return series, so a
deposit is never counted as a gain and cannot hide a drawdown. The benchmark
receives the identical cash flows.

**Dispersion simulation.** Resamples the security's own historical returns. It is
labeled as dispersion under a stated assumption, never as a forecast, and cannot
produce a shock larger than one already in the sample.

**Adjustment basis.** Price history is currently split- and dividend-adjusted
(the default of the underlying provider client). See `PROVIDERS.md` for why this
matters when the provider changes.

## Architecture

```
frontend/   React 19, TypeScript (strict), Vite, Recharts (lazy-loaded chunk)
  src/app/          hash router (pure route logic separated from components)
  src/pages/        one component per route
  src/features/     quote, chart, analysis, patterns, backtest, simulation,
                    portfolio, compare, explore, market, education, watchlist
  src/components/ui shared primitives, presentation only
  src/lib/          API client, formatting, chart preparation, CSV export, storage
  e2e/              Playwright smoke suite with fixture-mocked API

backend/    FastAPI, Python 3.11+
  app/analytics/    indicators, risk, interpretation, momentum, backtest,
                    patterns, portfolio -- pure functions, no I/O
  app/services/     market data, universe, provider integrations
  app/routes/       HTTP layer only
  app/middleware/   per-client rate limiting
  app/schemas.py    pydantic models; also generates the OpenAPI document
```

All indicator and risk math lives on the backend so there is one implementation.
The frontend plots date-aligned series it receives; it computes nothing that could
drift from the server.

## API

Seventeen JSON endpoints under `/api/v1`, documented interactively at
`http://127.0.0.1:8001/docs` when the backend is running.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe |
| `GET /api/v1/stocks/{ticker}?range=1Y` | Quote and price history |
| `GET /api/v1/stocks/{ticker}/analysis` | Indicators, risk statistics, evidence ledger, momentum |
| `GET /api/v1/stocks/{ticker}/backtest` | Walk-forward backtest of indicator rules |
| `GET /api/v1/stocks/{ticker}/patterns` | Historical pattern events and what followed them |
| `GET /api/v1/stocks/{ticker}/simulation` | Dispersion of bootstrapped outcomes |
| `GET /api/v1/market/compare?tickers=` | Side-by-side historical characteristics |
| `GET /api/v1/market/correlation?tickers=` | Return correlation matrix |
| `GET /api/v1/market/momentum?tickers=` | Momentum evidence for a basket |
| `GET /api/v1/portfolio/simulation?holdings=` | Hypothetical portfolio replay against a benchmark |
| `GET /api/v1/explore/match` | Preference matching over the disclosed ETF universe |
| `GET /api/v1/market/capabilities` | Which optional data features this deployment can serve |
| `GET /api/v1/market/status` | US trading session status |
| `GET /api/v1/market/movers` | Gainers, losers, most active |
| `GET /api/v1/market/sectors` | Sector performance snapshot |
| `GET /api/v1/market/search?q=` | Symbol search |
| `GET /api/v1/market/news/{ticker}` | Company headlines |
| `GET /api/v1/market/profile/{ticker}` | Company profile |

`range` accepts `1D`, `5D`, `1M`, `3M`, `6M`, `1Y`, `5Y`, `MAX`; each maps to a bar
interval that produces a usable series. Errors use real status codes with a
`{"detail": "..."}` body: `400` invalid input, `404` unknown ticker, `422`
validation, `429` rate limited, `501` not on the provider's plan, `502` upstream
failure, `503` provider not configured. Internal details are logged server-side
and never returned. Twenty-eight malformed-input cases are pinned by tests to
return a client error with no stack trace.

## Getting started

Requires Python 3.11 or newer and Node 20 or newer. No API keys are needed for
price history, indicators, risk, patterns, backtests, comparison, or portfolios.

```bash
# Backend -> http://127.0.0.1:8001
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Frontend -> http://localhost:5173  (new terminal)
cd frontend
npm install
npm run dev
```

## Configuration

Copy `.env.example` to `.env`. Everything has a working default. The two optional
keys unlock the market-context panels:

| Variable | Unlocks | Free tier |
|---|---|---|
| `FINNHUB_API_KEY` | Company news, symbol search | 60 calls/min |
| `FMP_API_KEY` | Movers, sector snapshot, company profile | 250 calls/day |
| `DEMO_MODE` | Synthetic dataset instead of a provider; live feeds off (see below) | n/a |

Without a key the corresponding panel explains that it is not configured rather
than rendering an empty box. Cache windows (`*_CACHE_TTL_SECONDS`), the client rate
limit (`RATE_LIMIT_PER_MINUTE`), provider timeout, and CORS origins are all in
`.env.example` with comments. The stock screener is not implemented because the
free FMP tier returns HTTP 402 for it; `/api/v1/market/capabilities` reports it as
unavailable.

## Testing

```bash
# Backend
cd backend
ruff check .
pytest                      # 424 tests; providers are stubbed, no network

# Frontend
cd frontend
npm run typecheck
npm run lint
npm test                    # 244 unit and component tests, 22 axe checks
npm run test:e2e            # 22 browser smoke tests over the production build,
                            # API answered from recorded fixtures
npm run build
```

Continuous integration runs all of the above on every push plus a secret scan
that fails the build if `.env`, `personal.md`, or `node_modules` is ever tracked.
The browser suite is deterministic by construction; one opt-in test
(`E2E_LIVE=1 npm run test:e2e:live`) exercises a real backend and is not run in
CI. Lighthouse on the production build scores 100 for accessibility, best
practices, and SEO on desktop and mobile (recorded in `METRICS.json`).

## Data providers and licensing

Price history comes from `yfinance`, an unofficial client for Yahoo Finance data.
It needs no account and is adequate for local, personal, educational use. **It is
not licensed for redistribution or commercial use, and neither Finnhub's nor
FMP's self-serve plans permit displaying their data to third parties.** Nothing in
this repository claims otherwise.

`PROVIDERS.md` contains the full inventory of what the application actually
requires from a data provider, the minimum contract a replacement must satisfy,
and an evaluation of five licensed providers (Massive/Polygon, Twelve Data,
Tiingo, Alpha Vantage, Financial Modeling Prep) against their published terms,
with every licensing statement labeled confirmed, probable, or needing written
confirmation. Its conclusion as of 2026-09-14: no self-serve plan at any of them
permits public display; the only published plan that does is Twelve Data's
Venture tier.

Nothing in the app is real-time and nothing claims to be. Every quote carries its
own timestamp and every chart states its bar frequency.

## Public demo and deployment status

A public demo runs at <https://stock-predictor-thebestgamer123s-projects.vercel.app> in **demo mode**: every price on
it comes from a deterministic synthetic dataset generated by
`backend/app/services/providers/demo.py`, frozen at 2025-12-31, with the
statistical shape of equity prices but describing no real security. The demo
exists because the default price provider is not licensed for public display
(`PROVIDERS.md`); redistributing real quotes would violate its terms. In demo
mode the live feeds (movers, sectors, news, profile) are switched off, the
quote header says "synthetic, not live market data", a banner reading "Demo
data" is shown on every page, and `/api/v1/market/capabilities` reports
`demo: true`. Company names are used only so the interface reads naturally.

The demo is deployed on Vercel as one project: the Vite build is served as
static files and the FastAPI app runs as a Python function behind `/api`
(`vercel.json`, `api/index.py`, root `requirements.txt`). No secrets are
required or configured.

**Real market data remains local-only.** Running the backend without
`DEMO_MODE` uses `yfinance` and should stay on a developer machine until a
provider whose terms permit public display is integrated and the conditions in
`PROVIDERS.md` section 6 are confirmed in writing.

## Known limitations

- The stock screener requires a paid data plan and is not implemented.
- Intraday ranges (1D, 5D) depend on the price provider offering intraday bars.
- The in-process cache and rate limiter are per-worker; a multi-instance
  deployment would need a shared store.
- Recharts is the whole lazy chart chunk (about 323 kB); it is loaded only when a
  chart is on screen.
- Indices such as `^GSPC` are accepted as tickers but no feature depends on them;
  the benchmark is the SPY ETF.

Open engineering questions are tracked in `TENSIONS.md`, current state in
`STATE.md`, measured numbers in `METRICS.json`, and durable lessons in
`LEARNINGS.md`. `CLAUDE.md` is the engineering procedure the project is developed
under, including its hard constraints.

## Contributing

Issues and pull requests are welcome. Before opening one:

- Run the full verification above; all of it must pass.
- Keep the product commitments: no forecasts, no verdicts, no fabricated data,
  `null` for missing values, caveats visible. A change that weakens a guard test
  will not be merged.
- Every statistic states its basis: window, frequency, observation count.
- Colors never carry meaning alone; pair them with a glyph or text.
- US English, tabular numerals for figures, no emojis in the codebase.

## License

MIT. See [LICENSE](LICENSE), which also carries the educational-use disclaimer.
