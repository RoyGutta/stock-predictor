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
| Analytics in the UI | ✅ evidence ledger and risk panel |
| Design system | ✅ tokens, light + dark, responsive, accessible |
| Beginner glossary | ✅ 16 terms in plain English |
| Tests | ✅ 160 backend, 67 frontend |
| CI | ✅ lint, types, tests, build, secret scan |
| Portfolio / watchlists / screener | ⬜ not started (needs a database) |

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
pytest              # 160 tests
ruff check .        # lint

# Frontend
cd frontend
npm test            # 67 tests
npm run typecheck
npm run lint
npm run build
```

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
