# Implementation Roadmap

Living document. Updated as milestones land.

**Last updated:** 2026-08-17
**Current state:** 247 backend tests, 76 frontend tests, lint and types clean both
sides, production build passing with no console warnings.

> Day-to-day state now lives in `STATE.md`; open problems in `TENSIONS.md`.
> This file tracks product phases only.

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
| 6 | Design system, feature architecture, analytics in the UI | `a6a3d70` |
| 7 | CI pipeline | `508a4c2` |
| 8 | Finnhub + FMP providers with capability gating | `39083f9` |
| 9 | Movers, sectors, news, ticker autocomplete | `eec660c` |
| 10 | XSS fix: reject non-http(s) feed URLs | `2c0b46d` |
| 11 | Ultra Code operating procedure + persistent state | `75ce307` |

### By phase

- **Phase 0** — complete.
- **Phase 1** — complete. Feature folders, hooks, services, API layer, utilities,
  constants. Strict TS throughout. Duplicated indicator math removed. Chart
  memoized, theme object memoized, chart animations disabled.
- **Phase 2** — complete. `.gitignore`, `.env.example`, gitignored `personal.md`,
  MIT license with disclaimer, CORS allowlist, input validation, opaque errors,
  rate limiting. CI now fails the build if a secret or `node_modules` is tracked.
- **Phase 3** — complete for the current surface. Design tokens, brass accent,
  tabular numerals, light and dark, responsive to 390 px, animations respecting
  `prefers-reduced-motion`. Verified in a browser in both themes.
- **Phase 4** — foundation done. 16-term glossary, each entry ending with what the
  concept does *not* tell you. No multi-step onboarding flow yet.
- **Phase 7** — mostly done. Movers, sector heatmap, session status, live prices.
  Missing: economic calendar, Fear & Greed, 52-week ranges (none on the free tiers).
- **Phase 11** — **blocked.** FMP serves its screener only on paid plans (HTTP
  402). Reported unavailable via `/market/capabilities` rather than faked.
- **Phase 12** — done. Debounced ARIA combobox autocomplete, recent searches.
  Missing: trending searches, company logos.
- **Phase 17** — partial. Real headlines with source and timestamp. Deliberately
  no AI summarization yet: summarizing financial news without a labeled,
  reviewable pipeline risks putting words in a source's mouth.
- **Phase 8** — mostly done. SMA, EMA, VWAP, RSI, MACD, Stochastic, ATR,
  Bollinger, ADX (+DI/−DI), OBV, Ichimoku. Missing: Volume Profile,
  support/resistance, candlestick patterns, gap detection.
- **Phase 9** — foundation done, deterministic. Evidence grouped bull/bear/neutral,
  conflicts surfaced, per-indicator caveats always visible, agreement score
  explicitly not a probability, no buy/sell output. LLM prose layer not started.
- **Phase 10** — computed and displayed. Volatility, drawdown with recovery dates,
  VaR, CVaR, Sharpe, Sortino, beta/alpha with R², correlation, Monte Carlo.
  Monte Carlo and correlation are not yet surfaced in the UI. No sector exposure.
- **Phase 13** — partial. Zoom via brush, crosshair, tooltips, timeframes,
  multiple indicators, CSV export. No pan, drawing tools, fullscreen, compare,
  PNG/PDF export.
- **Phase 18** — partial. Lazy-loaded chart, memoization, downsampling, no
  unnecessary refetch on display toggles. No virtualization or Lighthouse run.
- **Phase 19** — partial. 227 unit/integration/component tests. No E2E or
  automated accessibility tests.
- **Phase 20** — partial. README, AUDIT, ROADMAP, personal.md, generated OpenAPI
  docs. No architecture, deployment, contributing, or user guide.

---

## Next

Ordered by leverage.

### 1. Automated accessibility tests
The UI was checked by hand in a browser. `vitest-axe` over the rendered
components would keep it honest as the surface grows.

### 2. Surface Monte Carlo and correlation
Both are computed, tested, and unreachable from the UI. Dispersion in particular
is the clearest way to show a beginner what volatility actually means.

### 3. Phase 8 completion
Support/resistance, gap detection, candlestick patterns, Volume Profile — all
computable from data already fetched.

### 4. Phase 4 completion — onboarding flow
A guided first-run path rather than a glossary panel alone.

### 5. Phases 5/6/14/15/16 — persistence
Database, auth, portfolio builder, watchlists, paper trading. Largest chunk;
everything here needs a persistence layer that does not exist yet.

---

## Standing constraints

Not negotiable; these shape every decision above.

1. **No fabricated market data.** If a provider is unavailable, the app says so.
2. **No predictions.** Indicators describe the past. Monte Carlo is labeled as
   dispersion under an explicitly stated assumption, not a forecast.
3. **No buy/sell verdicts.** Evidence on both sides; conflicts surfaced.
4. **Every statistic states its basis** — window, frequency, observation count.
5. **Absent statistics are null, never zero.** Enforced from the API through to
   the formatters, and asserted by tests at both ends.
6. **Caveats are never hidden** behind a disclosure.

---

## Known gaps

- `yfinance` is unlicensed for redistribution. Fine locally; must be replaced
  before any public deployment. Tracked in `personal.md`.
- The in-process cache and rate limiter are per-worker. Multi-instance deployment
  needs Redis (`REDIS_URL` is already in `.env.example`).
- Recharts is 329 kB and is the whole lazy chunk. A lighter charting approach
  would help, but not before the chart feature set is settled.
- No E2E tests, no Lighthouse measurement.
