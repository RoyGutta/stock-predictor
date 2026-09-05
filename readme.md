# Stock Predictor

An educational market-analysis tool. Look up any listed ticker, chart its real price
history, and overlay standard technical indicators — with plain-English explanations of
what each one actually measures.

> **This is not investment advice, and it does not predict prices.**
> Every number it shows describes *past* price behavior. Technical indicators are
> descriptive statistics, not forecasts. See [Scope and honesty](#scope-and-honesty).

---

## Status

The data pipeline, API, indicator math, and UI are real, tested, and verified against
live market data. What is missing is anything requiring a database or a licensed data
provider — those are listed as not started rather than stubbed with fake data.

| Area | State |
|---|---|
| Market data API | ✅ cached, rate-limited, validated |
| Technical indicators | ✅ 11 indicators, unit-tested against hand-computed values |
| Risk statistics | ✅ Sharpe, Sortino, drawdown, VaR, beta/alpha, Monte Carlo |
| Interpretation engine | ✅ evidence-based, no buy/sell verdicts |
| Interactive chart | ✅ zoom, crosshair, indicator overlays, CSV export |
| Analytics in the UI | ✅ evidence ledger, risk panel, dispersion, correlation |
| Walk-forward backtesting | ✅ lookahead-guarded, costs on, benchmark always shown |
| Momentum (20/50/100) | ✅ evidence shown; insufficient history is not bearish |
| Hypothetical portfolio simulator | ✅ time-weighted stats; deposits never read as gains |
| Security comparison | ✅ 2–6 tickers, same window and method, no ranking |
| Multi-page app shell | ✅ hash routing, deep links, keyboard/AT navigation |
| Explore (preference matching) | ✅ disclosed ETF universe, every criterion shows its measurement |
| Watchlist | ✅ persisted locally, live quotes, momentum sorting |
| Design system | ✅ tokens, light + dark, responsive, accessible |
| Beginner glossary | ✅ plain English, each entry states its limits |
| Historical patterns | ✅ anti-lookahead by tested property, sample sizes always shown |
| Tests | ✅ 395 backend, 217 frontend (20 automated a11y checks) |
| CI | ✅ lint, types, tests, build, secret scan |
| Live market data | ✅ movers, sector heatmap, session status |
| News + ticker search | ✅ real headlines, debounced autocomplete |
| Stock screener | ⛔ needs a paid data plan — see below |

A full inventory is in [AUDIT.md](AUDIT.md); current priorities are in [ROADMAP.md](ROADMAP.md).

---

## Quick start

Requires **Python ≥ 3.11** and **Node ≥ 20**. No API keys needed.

```bash
# 1. Backend  ->  http://127.0.0.1:8001
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# 2. Frontend (new terminal)  ->  http://localhost:5173
cd frontend
npm install
npm run dev
```

Interactive API docs are at <http://127.0.0.1:8001/docs>.

Configuration is optional — copy `.env.example` to `.env` to change anything.
For account signups, rate limits, and deployment steps, see `personal.md`
(created locally, gitignored).

---

## Architecture

```
frontend/                React 19 + TypeScript (strict) + Vite
  src/styles/            design tokens; light and dark both first-class
  src/components/ui/     shared primitives — presentation only, no data access
  src/features/          quote, chart, analysis, education (each owns its CSS)
  src/hooks/             theme, ticker data loading
  src/lib/               api client, chart prep, formatting, CSV export
  src/types/market.ts    types mirroring the backend schemas

backend/                 FastAPI + Python 3.11+
  app/config.py          env-driven settings; refuses unsafe production config
  app/schemas.py         pydantic response models (also generates the OpenAPI docs)
  app/analytics/         indicators, risk statistics, interpretation — pure functions
  app/services/          market data providers behind a narrow interface
  app/routes/            HTTP layer only
  app/middleware/        rate limiting
```

Three decisions worth knowing about:

**Market data is cached server-side.** The default provider (`yfinance`) is an unofficial
scraper with an undocumented rate limit — without a cache, a handful of users exhausts it
and the app dies for everyone. Quotes cache for 60 s; company profiles for 24 h, since
`Ticker.info` is by far the most expensive upstream call and company names rarely change.

**The provider sits behind an interface.** `yfinance` is fine locally but is not licensed
for commercial use or redistribution. Swapping in a properly-licensed provider means
implementing one module, not touching the routes.

**All indicator math lives on the backend.** MACD needs EMA and ADX needs ATR, so a
second copy in the frontend would inevitably drift. The analysis endpoint returns
date-aligned indicator series and the frontend plots them — bars where an indicator is
not yet defined serialize as `null`, so the chart draws a gap rather than a line
plunging to zero.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness probe |
| `GET /api/v1/stocks/{ticker}?range=1M` | Quote + candles |
| `GET /api/v1/stocks/{ticker}/analysis?range=1Y` | Indicators, risk stats, interpretation |
| `GET /api/v1/market/capabilities` | Which data features this deployment can serve |
| `GET /api/v1/market/status` | US trading session (no API key needed) |
| `GET /api/v1/market/movers` | Top gainers, losers, most active |
| `GET /api/v1/market/sectors` | Sector performance |
| `GET /api/v1/market/search?q=` | Ticker search |
| `GET /api/v1/market/news/{ticker}` | Recent company news |
| `GET /api/v1/market/profile/{ticker}` | Company fundamentals |
| `GET /api/v1/market/momentum?tickers=` | Momentum ranking for a basket |
| `GET /api/v1/market/correlation?tickers=` | Return correlation matrix |
| `GET /api/v1/market/compare?tickers=` | Side-by-side historical characteristics |
| `GET /api/v1/stocks/{ticker}/backtest` | Walk-forward backtest of indicator rules |
| `GET /api/v1/stocks/{ticker}/patterns` | Historical pattern events and what followed them |
| `GET /api/v1/stocks/{ticker}/simulation` | Dispersion of bootstrapped outcomes |
| `GET /api/v1/portfolio/simulation?holdings=` | Hypothetical portfolio replay vs benchmark |
| `GET /api/v1/explore/match` | Preference matching over a disclosed 20-ETF universe |

`range` accepts `1D`, `5D`, `1M`, `3M`, `6M`, `1Y`, `5Y`, `MAX`. Each maps to a candle
interval that suits the period, so `1D` returns intraday 5-minute bars rather than a
single point.

Errors use real HTTP status codes with a `{"detail": "..."}` body: `400` invalid ticker,
`404` unknown ticker, `429` rate limited, `502` upstream failure. Internal error details
are logged server-side and never returned to the client.

### What the analysis endpoint deliberately does not return

No buy/sell verdict, no price target, no probability that a stock will rise.

It returns evidence grouped into bullish, bearish, and neutral observations, shown side
by side. Where indicators contradict each other, the contradiction is reported rather
than averaged into a single score — a mixed picture is usually the most informative thing
the data has to offer, and hiding it behind one number is the dishonest move.

Every observation carries that indicator's known failure mode as a required field. RSI
above 70 comes with the note that strong trends hold it there for months; moving-average
crossovers come with the note that they lag by construction.

The `agreement_score` measures how much the indicators agree **with each other** — not
how likely anything is. Because indicators are recomputed from the same price series,
agreement is partly an artifact of shared inputs rather than independent confirmation,
and the payload says so. Statistics that cannot be computed from the available history
are returned as `null`, never as `0`.

---

## Development

```bash
# Backend
cd backend
pip install -r requirements-dev.txt
pytest              # 395 tests
ruff check .        # lint

# Frontend
cd frontend
npm test            # 217 tests
npm run typecheck
npm run lint
npm run build
```

---

## Data providers

The app runs with **no API keys at all** — price history, charts, indicators, and
risk statistics all work from `yfinance`, which needs no account.

Two optional free-tier keys unlock the market-wide features. Both are free and
need no credit card; see `personal.md` for signup links.

| Feature | Provider | Free tier |
|---|---|---|
| News, ticker search | Finnhub | ✅ 60 calls/min |
| Movers, sectors, fundamentals | FMP | ✅ 250 calls/day |
| **Stock screener** | FMP | ❌ **paid plans only (HTTP 402)** |

`GET /api/v1/market/capabilities` reports exactly what the running deployment can
serve, and the UI explains any missing feature rather than rendering an empty
panel. **The screener is not implemented** because the free tier cannot serve it —
building a UI that returns invented rows would be worse than not having one.

---

## Scope and honesty

The repository is named "Stock Predictor" — a name it inherited. It is worth being
direct about what that does and does not mean:

- **It does not predict prices.** There is no forecasting model, and none is planned that
  would be presented as a prediction. Nobody can reliably forecast individual stock prices;
  a tool that implies otherwise is misleading regardless of how good its charts look.
- **All market data is real**, fetched live from the upstream provider. Nothing is
  simulated, synthesized, or filled in with placeholder values. If data is unavailable, the
  app says so rather than inventing it.
- **Indicators are descriptive.** An SMA crossover is a statement about what prices already
  did. It carries no information about what they will do next.
- **Any future AI-generated text will be labeled as such**, and will explain the computed
  indicators rather than issue buy/sell calls.

## License

MIT — see [LICENSE](LICENSE), which also carries the full educational-use disclaimer.
