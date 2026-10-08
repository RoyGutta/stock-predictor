# Market-data provider evaluation

Research record for replacing `yfinance`, the one dependency that blocks a public
deployment (`TENSIONS.md` T-3). Written 2026-09-14 from the repository as it stands
and from each provider's official pricing, terms, and documentation pages, fetched
that day. Section 8 records the re-verification of 2026-10-08 and the decision
status; where it disagrees with sections 3-7, section 8 is current. Nothing here
is a legal opinion. Every licensing statement carries one
of four labels:

- **Confirmed** -- stated in the provider's published terms, pricing, or docs (URL given).
- **Probable** -- a reasonable reading of published terms, not stated outright.
- **Needs provider confirmation** -- the terms are silent or ambiguous; get it in writing.
- **Not permitted** -- the published terms prohibit it.

"API available" is never treated as "public display permitted". The two are
different rights and every provider below separates them.

---

## 1. What the application actually needs

Traced provider -> `app/services` -> routes -> frontend. Nothing listed here is
speculative; each row is used by shipped code.

### 1.1 The price path (currently `yfinance`, not behind the provider interface)

| Need | Where it is consumed | Exact requirement |
|---|---|---|
| Historical OHLCV bars | `get_quote()` -> every analytics route (`stocks`, `analysis`, `backtest`, `patterns`, `simulation`, `compare`, `correlation`, `momentum`, `portfolio`, `explore`) | `date`, `open`, `high`, `low`, `close`, `volume` per bar; ISO dates; oldest to newest; no NaN closes |
| Bar frequency by range | `_RANGE_PARAMS` in `market_data.py`; `_FREQUENCY_BY_RANGE` in `analysis.py` and `explore.py` | 1M/3M/6M/1Y daily; 5Y weekly; MAX monthly. Weekly and monthly can be resampled server-side from daily -- a provider only has to supply daily |
| Intraday bars | 1D (5-minute) and 5D (30-minute) ranges only | Optional. If a provider lacks intraday, those two ranges must be gated as unavailable, which needs a `PRICES_INTRADAY` capability (see 2.3) |
| Historical depth | MAX range; explore and portfolio use 5Y weekly; minimum bars: risk 30, portfolio 40, backtest 60 (120 for walk-forward), patterns 60, momentum 105 | At least 5 years of daily history; full history preferred for MAX |
| Adjustment | Implicit: `yf.Ticker.history()` defaults to `auto_adjust=True`, never overridden | The app today consumes **split- and dividend-adjusted OHLC**. All returns, drawdowns, backtests and portfolio replays are total-return-style. A replacement must either supply the same, or the project must decide explicitly to switch to price-return series (a documented methodology change, not a silent one) |
| Corporate actions as data | Not consumed anywhere | Splits and dividends are needed only if the provider supplies unadjusted prices and the app adjusts them itself |
| Company name, currency | `_fetch_profile_sync` (`Ticker.info`: `longName`/`shortName`, `currency`) -> `Quote.company_name`, `Quote.currency` -> quote header, recent searches, compare headers | Two strings; failure degrades to the symbol and "USD" |
| Benchmark | `SPY` hard-coded in `analysis.py`, `portfolio.py`, `explore.py` | One ETF with the same history as the security. `^GSPC` is merely accepted by validation; no feature requires an index |
| Universe | `universe.py`: 20 ETFs (VOO VTI QQQ VIG SCHD VEA VWO VXUS BND AGG SHY TLT VNQ GLD XLK XLV XLF XLE XLP XLU) plus SPY, fetched concurrently per explore call | ETF coverage is mandatory |
| Source label | `Quote.source` -> "data from {source}" in the quote header | Attribution hook already exists in the UI |

### 1.2 The market-context path (already behind `providers/base.py`)

| Need | Provider today | Fields used |
|---|---|---|
| Company news | Finnhub `company-news` | headline, summary, source, url (http/https only), datetime, image |
| Symbol search | Finnhub `search` | symbol, description/name, type |
| Movers | FMP `biggest-gainers`, `biggest-losers`, `most-actives` | symbol, name, price, change, changesPercentage, exchange |
| Sector snapshot | FMP `sector-performance-snapshot` | sector, averageChange |
| Company profile | FMP `profile` | companyName, sector, industry, country, exchange, marketCap, beta, lastDividend, averageVolume, fullTimeEmployees, website, description, ceo, isEtf |
| Screener | none (FMP `company-screener` returns 402 on the free tier, re-verified 2026-09-14) | not implemented; reported unavailable via `/market/capabilities` |
| Market session status | computed locally from the clock | no provider |

Not used anywhere: fundamentals beyond the profile card, options, forex, crypto,
real-time streaming, historical news archives, index constituents.

---

## 2. Minimum replacement-provider contract

### 2.1 Where the seam is

`providers/base.py` gives Finnhub and FMP a shared `Capability` enum, typed errors
(`ProviderError` 502, `ProviderNotConfigured` 503, `ProviderPlanRequired` 501),
`get_json()` with key-safe logging, and an httpx client. **Prices are not behind
it.** `market_data.py` calls yfinance directly through two synchronous functions:

```python
_fetch_history_sync(ticker: str, period: str, interval: str) -> list[dict]   # date, price, open, high, low, volume
_fetch_profile_sync(ticker: str) -> dict                                      # company_name, currency
```

Every backend test that needs prices monkeypatches exactly these two functions.
They are the de facto interface, and they are the only two functions a replacement
must provide to keep all 424 tests meaningful.

### 2.2 Method contract

**`fetch_history(ticker, range) -> list[Candle]`**

- Input: normalized ticker (`^[A-Z0-9][A-Z0-9.\-=]{0,14}$`, optional leading `^`),
  one of the eight `Range` values.
- Output: bars oldest-first; `date` ISO-8601 (`YYYY-MM-DD` for daily and coarser,
  full timestamp for intraday); `price` = close; `open`, `high`, `low` floats;
  `volume` int. Rounded to 4 decimals as today.
- Adjustment: split-adjusted **required**; dividend-adjusted **required to preserve
  current behavior** (see 1.1). If only unadjusted bars plus splits/dividends are
  available, the adjustment must be computed server-side and tested against a
  known split (AAPL 2020-08-31 4:1 is in every provider's data).
- Weekly/monthly: may be resampled from daily server-side (pandas
  `resample("W-FRI")` / `("MS")` on OHLCV) rather than requested from the provider.
- Missing data: an empty list means unknown ticker -> `UnknownTickerError` (404).
  A bar with a NaN close is dropped, never zero-filled. Fewer bars than a feature
  needs is handled downstream (each feature already returns its "insufficient
  history" result) -- the provider must not pad.
- Errors: timeouts and transport failures -> `MarketDataError` 502 with an opaque
  message; the real cause is logged without the key. Plan-gated endpoints ->
  `ProviderPlanRequired` (501) so the UI can say "not on this plan" rather than
  "broken".
- Rate limits: the 60 s quote cache is the only protection today; a replacement
  must survive the explore fan-out (21 symbols concurrently, one per ETF plus SPY)
  within its per-minute limit, or the fan-out must be bounded with a semaphore.
- Caching: 60 s quotes, 24 h identity. A provider whose terms forbid persistent
  caching (Tiingo's free tier does) is incompatible with the in-process TTL cache
  unless the cache is disabled, which the yfinance rate limit made necessary in
  the first place.

**`fetch_identity(ticker) -> {company_name: str, currency: str}`**

- Failure degrades to `{ticker, "USD"}`; never blocks a price response.

### 2.3 Interface changes that were needed (implemented 2026-10-03)

All four items below shipped in the provider-abstraction phase: `PriceProvider`
in `providers/prices.py`, `Capability.PRICES`/`INTRADAY`, provider-driven
`Quote.source`, and `Quote.adjustment` plus `adjustment` and `price_source` in
`/api/v1/market/capabilities`. yfinance is now `providers/yahoo.py`, one adapter
behind the same contract as the synthetic provider; the registry refuses it in
production. Section 2.1 describes the seam as it was before this change.

Original list, kept for the record:

1. Add `Capability.PRICES` and `Capability.PRICES_INTRADAY` so `/market/capabilities`
   can report a price provider that lacks intraday, and the range selector can
   disable 1D/5D honestly instead of returning "no market data found".
2. Move the two functions behind a `PriceProvider` protocol in
   `app/services/providers/` and select the implementation from settings, keeping
   the existing test seam (patch the provider, not yfinance).
3. Make `Quote.source` come from the provider so the UI's attribution line and any
   provider-required credit text are correct automatically.
4. Record the adjustment basis (`"split+dividend"` or `"split"`) in the analysis
   payload so the UI can state it, per the project rule that every statistic
   states its basis.

None of these is a rewrite. Estimated migration effort for any REST provider with
daily adjusted bars: one module plus a fixture rebuild for `frontend/e2e/fixtures`
and the API test stubs.

---

## 3. Candidates

### 3.1 Massive (formerly Polygon.io)

Sources: https://massive.com/pricing · https://massive.com/business ·
https://massive.com/legal/market-data-terms-of-service ·
https://massive.com/legal/individuals-terms-of-service ·
https://massive.com/knowledge-base/article/how-can-i-redistribute-massives-market-data

- Public display to anonymous users: **Not permitted on any Individual plan**
  (Basic $0, Starter $29, Developer $79, Advanced $199). Market Data ToS §5(c)
  prohibits displaying or publishing the data "or any data, charts, analytics,
  research, or other works based on or derived from" it to third parties without
  written consent. Business plan ($2,499/mo) advertises "commercial and display
  rights". Whether that covers anonymous public visitors without a signed order
  form: **needs provider confirmation**.
- Derived analytics: explicitly inside the §5(c) prohibition on Individual plans
  (**Not permitted**); **Probable** on Business.
- Caching: not addressed (**needs provider confirmation**); irrelevant while
  display is prohibited.
- Attribution: none required (**Confirmed**, absence).
- Educational/non-profit: no exemption. Individual plans are "personal and
  non-professional"; an organization account is a Professional Subscriber and must
  use Business plans (**Confirmed**).
- Technical (**Confirmed**): daily aggregates with `adjusted=true` = split-adjusted
  only; dividends endpoint supplies adjustment factors; history 2y/5y/10y/20y+ by
  tier; ETFs covered; indices are a separate product with history only from
  2023-02; minute bars on all plans (Basic is end-of-day); unlimited calls on paid.
- Cost for this use case: **$2,499/mo** (Business). 

### 3.2 Twelve Data

Sources: https://twelvedata.com/pricing · https://twelvedata.com/pricing-business ·
https://twelvedata.com/terms ·
https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage ·
https://support.twelvedata.com/en/articles/11116616-non-profit-organisation-subscription ·
https://support.twelvedata.com/en/articles/12647398-attribution-guidelines-for-using-twelve-data

- Public display to anonymous users: **Not permitted on Individual plans** (Basic
  $0 "internal non-display", Grow $29-79 "internal display", Pro, Ultra). Plans
  are "strictly for personal or internal use"; educational projects count as
  internal use only. **Venture is the tier whose published card states "external
  display data access"**; it is sold in three sizes, $149 / $299 / $499 per month
  for 610 / 1,597 / 2,584 API credits per minute (pricing page rendered in a
  browser, 2026-10-08; the static card shows only the $499 size). Whether that
  right covers anonymous, unauthenticated visitors is strongly indicated but not
  stated (section 8.1). Enterprise $1,099 adds external distribution.
- Derived analytics: terms permit derived data that cannot be reverse-engineered
  into the original series (§2.2(c)); display of it still follows the tier's
  display right (**Probable** on Venture).
- Caching: prohibited "beyond permitted timeframes specified in the
  Documentation" (§2.3(g)). The Documentation's only statement on caching, the
  Quickstart best-practices list, recommends caching responses and names no
  timeframe (verified 2026-10-08); §16.1 allows retention "for duration permitted
  by subscription". A short server-side TTL is therefore strongly indicated but
  the period itself **needs provider confirmation**.
- Attribution (**Confirmed**): "Data provided by Twelve Data" with a dofollow link
  near each chart or table.
- Non-profit route (**Confirmed to exist**; article updated 2026-03-12): free
  access to "one of our standard plans, tailored to their scale and technical
  needs" for organisations "registered as a non-profit or academic institution"
  whose use "does not generate revenue". The article's own plan table lists
  **Venture ("External display data access", "for public platforms and
  data-driven apps")** among the plans it assigns, so external display is within
  the programme's published scope; which plan is assigned is Twelve Data's
  decision. Not eligible: for-profit companies, paywalled or monetised projects,
  resellers. Obligations: annual renewal update; a permanent, visible recognition
  text naming the organisation, with a dofollow link on a prominent page "not in
  the footer" (the article supplies the wording), in addition to the general
  attribution rule. Application: organisation brief, planned use, confirmation of
  non-commercial intent, "formal documentation of non-profit status". The grant
  attaches to the registered organisation for the described use, not to a
  project in the abstract (section 8.1, entity row).
- Technical (**Confirmed**): `/time_series` daily back to first trade date;
  `adjust=all|splits|dividends|none` (default splits) -- dividend adjustment
  available, matching current behavior; splits and dividends endpoints (dividends
  from Grow); ETFs and 5,000+ indices including S&P 500 (plan level for SPX
  itself unclear; SPY works regardless); intraday intervals on all plans;
  `/symbol_search`; `/profile` from Grow; **no news endpoint found**; credits per
  symbol with batching; documented JSON errors with 400/401/403/404/429.
- Cost for this use case: **$149/mo** (Venture, 610 credits/min), or **$0 if the
  Non-Profit programme assigns Venture and the grant letter says so**.

### 3.3 Tiingo

Sources: https://app.tiingo.com/tos/ · https://www.tiingo.com/about/pricing ·
https://www.tiingo.com/documentation/general/overview ·
https://www.tiingo.com/documentation/end-of-day

- Public display: **Not permitted on any standard plan.** ToS §7.3: data is for
  internal consumption; "redistribution is only available upon special request
  and permission, and comes with additional fees"; the pricing page defines
  internal use as "you may not display or share the data". Redistribution license:
  $250/mo (startup) or $500/mo (enterprise), negotiated by email.
- Derived analytics: the most specific clause of any provider (§1.6(c)). Aggregate
  statistics such as Sharpe, Sortino, volatility and correlations are permitted;
  **anything that reproduces a price series is not** -- explicitly "simple
  transformations of open, high, low, close, volume", resampled series, and
  "dashboards that display Tiingo Data". Price charts, moving averages, RSI/MACD
  series, drawdown curves and portfolio replay curves are therefore **Not
  permitted** without the redistribution license.
- Caching: free tier may hold data only "transiently in volatile memory"
  (**Not permitted** for the 24 h identity cache); paid plans "to the extent
  permitted by that Paid Plan" (**needs provider confirmation**).
- Attribution (**Confirmed**, if redistribution is granted): "Data sourced by
  Tiingo" with link.
- Educational: no carve-out (**needs provider confirmation** whether a discounted
  redistribution license exists for education).
- Technical (**Confirmed**): the best end-of-day dataset here -- from 1962,
  adjusted OHLCV plus `divCash` and `splitFactor`, CRSP-style adjustment, ETFs;
  no index coverage; IEX intraday from 2017; search endpoint is beta; error codes
  undocumented.
- Cost for this use case: **$250-500/mo**, by negotiation.

### 3.4 Alpha Vantage

Sources: https://www.alphavantage.co/terms_of_service/ ·
https://www.alphavantage.co/premium/ · https://www.alphavantage.co/documentation/ ·
https://www.alphavantage.co/support/

- Public display: **Not permitted on any self-serve plan.** ToS §2(a) licenses
  "personal, non-commercial use, unless ... agreed otherwise in writing";
  commercial use is defined to include anything "beyond activities that are
  private and individual in nature" and any activity that lets others access the
  information. Premium buys rate limits, not rights (**Confirmed**).
- Educational lever (**needs provider confirmation**): the support FAQ offers
  "unlimited API requests for verified open-source or educational projects". It
  reads as a rate-limit waiver, not a display license; no process or terms are
  published.
- Derived analytics: no carve-out; governed by the same personal-use limit
  (**Probable not permitted**).
- Caching: not addressed. Attribution: none required.
- Technical (**Confirmed**): `TIME_SERIES_DAILY_ADJUSTED` (adjusted close,
  dividend, split coefficient) and full 25+ year history are **premium-only**;
  `INDEX_DATA` needs the $99.99+ tier; free tier is 25 requests/day; throttling is
  signalled by an HTTP 200 with an `"Information"` body, which the existing
  `get_json()` would need to learn.
- Cost for this use case: $49.99/mo for the data, $99.99/mo with index data, plus
  a written agreement that does not exist as a product.

### 3.5 Financial Modeling Prep (already used for movers, sectors, profile)

Sources: https://site.financialmodelingprep.com/developer/docs/pricing ·
https://site.financialmodelingprep.com/terms-of-service · live probes of
`https://financialmodelingprep.com/stable` with the project's free key on
2026-09-14 (status codes and field names only).

- Public display: **Not permitted on any self-serve plan, free or paid.** Terms
  §2.2.1 (Personal Use) restrict every self-serve licence to an individual's
  "personal, non-business and non-commercial purposes" and forbid integrating the
  data "into any tools or applications accessible by any third parties". §2.2.2
  (Data Display): "Without a specific agreement with FMP, customers are prohibited
  from showcasing FMP Services or Data on platforms including but not limited to
  websites ... irrespective of whether such usage is complimentary or paid." The
  pricing page repeats it: "Displaying or redistributing data sourced from FMP
  requires a specific Data Display and Licensing Agreement with FMP." Toggling the
  pricing page to "Commercial Use" shows a single Enterprise plan with custom
  pricing. (**Confirmed**)
- Derived analytics: §2.6.1 forbids providing "data or information contained in
  or derived from The Services" to any third party (**Not permitted** without the
  agreement).
- Caching: permitted in the sense that §6.3 requires deleting "data cached" on
  termination and §2.8 requires notifying FMP of the domains where data is stored
  (**Confirmed**, with obligations).
- Attribution: not addressed.
- Personal-use prices (**Confirmed** from the pricing page): Basic $0 (250
  calls/day, 5 years), Starter $19/mo (300 calls/min, 5 years), Premium $49/mo
  (750 calls/min, 30+ years, intraday), Ultimate $99/mo (3,000 calls/min, full
  history, 1-minute intraday). Bandwidth caps 500 MB / 20 GB / 50 GB / 150 GB per
  trailing 30 days.
- Screener: the pricing page's feature matrix could not be read unambiguously;
  the live probe is authoritative: `company-screener` returns **402 "Restricted
  Endpoint"** on the free key (**Confirmed**). Which paid tier unlocks it:
  **needs provider confirmation**.
- Live probe of the free key (**Confirmed**): `historical-price-eod/full` returns
  exactly 5 years (1,253 daily rows) with `open, high, low, close, volume, vwap,
  change, changePercent` and **no adjusted close**; `dividends` (back to 1987) and
  `splits` return 200, so the app could adjust prices itself; `^GSPC` and `SPY`
  history both return 200; `historical-chart/5min` and `news/stock` return 402;
  `search-symbol?query=` returned an empty list (parameter name unverified).
- Documented error behavior seen live: 402 with a plain-text "Restricted
  Endpoint" body for plan-gated endpoints; 403 "Legacy Endpoint" on retired
  `/api/v3` paths (observed 2026-08-05); 401 `{"Error Message": "Invalid API
  KEY"}`. The existing `get_json()` already maps 402 and the 403 body to
  `ProviderPlanRequired`.
- Nasdaq 15-minute delay disclaimer: not found on the pricing or terms pages
  fetched; **needs provider confirmation**.
- Assessment: consolidating on FMP would remove one vendor (Finnhub) only if a
  paid tier also covers news and search, and it would not change the licensing
  position at all -- display needs the separate agreement whatever the plan. The
  existing screener dependency is not a reason to prefer FMP; it is the same
  contract question with a sales conversation attached. Contacting sales is
  reasonable **only** to ask for the Data Display and Licensing Agreement terms and
  price for a non-commercial educational site; there is no published route.

### 3.6 Finnhub (already used for news and search)

Sources: https://finnhub.io/terms-of-service (pricing page is script-rendered and
could not be read by the fetcher; not re-verified).

- Public display: **Not permitted.** "You hereby agree to not redistribute or
  share access to data or derived results from the data obtained from Finnhub
  with anyone or any 3rd party without written approval from Finnhub. All plan
  listed on Finnhub website is strictly for personal use unless explicitly stated
  otherwise." (**Confirmed**)
- Consequence for the current app: the news and search panels, as deployed
  publicly, would also require Finnhub's written approval. This was not
  previously recorded and is recorded in `TENSIONS.md` as T-8.
- Technical: not re-verified this round; the historical candle endpoint's
  free-tier status is **needs provider confirmation**.

### 3.7 Others considered

Nasdaq Data Link, EODHD, Marketstack and Databento were queued for research; the
agent assigned to them was cut off by a session limit before fetching any page.
They are **unverified** and deliberately absent from the matrix rather than
filled in from memory. None is known to offer a self-serve public-display right
either, but that is an assumption, not a finding.

---

## 4. Comparison matrix

| Provider | Public anonymous display | Derived analytics | Raw price charts | Historical OHLCV | Adjustments | ETFs / indexes | News | Rate limits | Required plan | Monthly cost | Attribution | Caching | Migration | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Massive/Polygon | Not permitted (Individual); Probable (Business) | Same | Same | 2-20+ y by tier | split only; dividends separate | ETFs yes; indices from 2023 | yes | unlimited (paid) | Business | $2,499 | none | unclear | low-medium (adjust for dividends yourself) | high |
| Twelve Data | Not permitted (Individual); **Venture: strongly indicated, anonymous visitors not stated**; Non-Profit may assign Venture | Probable on display tier | Same | full daily | `adjust=all` matches today (daily+); intraday unadjusted | ETFs yes; indices yes | **none** | 610-2,584 credits/min, no daily cap | Venture, or Non-Profit if granted | $149-499, or $0 | required, dofollow link | timeframe unpublished; docs recommend caching | low | high on rights, medium on anonymous scope |
| Tiingo | Not permitted (standard); redistribution license by email | statistics only; series not permitted | Not permitted | 1962-, best quality | full adjusted + divCash/splitFactor | ETFs yes; no indices | Power+ | hourly/daily | Redistribution | $250-500 | required | free: memory only | low | high |
| Alpha Vantage | Not permitted (self-serve); written agreement only | Probable not permitted | Same | 25+ y (premium) | adjusted (premium) | ETFs yes; index $99.99+ | yes | 25/day free; 75+/min paid | none exists as a product | $49.99-99.99 + agreement | none | unclear | medium (200-body errors) | high |
| FMP | Not permitted (all self-serve); Data Display Agreement only | Not permitted without agreement | Same | 5 y free/Starter; 30+ y Premium | **unadjusted**; splits + dividends provided | ETFs yes; ^GSPC yes | 402 on free | 250/day free; 300-3,000/min paid | Enterprise + Display Agreement | custom | not addressed | allowed with obligations | medium (self-adjust) | high |
| Finnhub | Not permitted (all listed plans) | Not permitted | n/a | unverified | unverified | unverified | yes (current) | 60/min free | written approval | unpublished | none stated | delete on cancel | n/a | high on rights |

Migration difficulty assumes the seam in 2.1: one module, fixture rebuild,
`Quote.source` update. "Same" means the cell inherits the display column.

---

## 5. Ranking

1. **Best candidate for public deployment: Twelve Data Venture (from $149/mo).** It is
   the only provider whose published, self-serve plan states external display
   rights, it supplies dividend-adjusted daily history (so the app's methodology
   is unchanged), covers ETFs and indices, and documents its errors. Gaps: no news
   endpoint (Finnhub would remain, and Finnhub also needs written approval), and
   the cache-retention timeframe must be confirmed.
2. **Cheapest legitimate public-display option: Twelve Data Venture 610 at
   $149/mo** (corrected 2026-10-08; the plan has three sizes). Every $0-$99 tier
   at every provider remains personal or internal use only. Tiingo's $250/mo
   redistribution license is not cheaper in practice: its revised §1.6(c)
   (2026-10-06) still prohibits price paths, equity curves and resampled series
   without separate written approval.
3. **Best candidate if a non-profit or educational exception is granted: Twelve
   Data's Non-Profit plan.** It exists as a published programme, unlike Alpha
   Vantage's FAQ line or anything at FMP, and its plan table names Venture with
   external display. It requires the account to belong to a registered non-profit
   or academic institution; the assigned plan and its display scope must appear in
   the grant letter. A personal project does not qualify.
4. **Best technical migration candidate: Twelve Data**, for the `adjust=all`
   parity, followed by Tiingo for data quality. Massive is technically excellent
   but would require computing dividend adjustment from its factor endpoint.
5. **Reject: Massive/Polygon and FMP for this use case.** Massive because the only
   display-licensed plan is $2,499/mo; FMP because display is prohibited on every
   self-serve plan and the commercial route is a custom Enterprise contract plus
   a separate display agreement -- and it would still not supply adjusted prices.
   Alpha Vantage is rejected on the same logic unless its educational programme
   turns out to include display rights in writing.

---

## 6. What must be confirmed in writing before any public deployment

> Superseded 2026-10-08 by the smaller list in section 8.3, which reflects what
> the published terms now answer. Kept for the record.

For the chosen provider (Twelve Data unless the decision changes):

1. That the plan's "external display data access" covers anonymous, unauthenticated
   visitors to a free educational website, with no per-viewer fee.
2. That server-side caching of daily bars for up to 24 hours and of company
   identity for 24 hours is within the permitted retention timeframe.
3. That derived series (moving averages, RSI, MACD, drawdown curves, portfolio
   replay curves, backtest equity curves) may be displayed alongside the price
   chart, not only aggregate statistics.
4. Whether the Non-Profit plan (if pursued) includes item 1, and which legal entity
   must hold the account.
5. Exact attribution wording and placement they require.
6. That the exchange-fee position for end-of-day US equity data ("requires no
   additional licensing" per their support article) applies to public display.

For Finnhub (if news and search stay): written approval for displaying company
news headlines and search results to anonymous users, or removal of those panels
from the public build.

Questions to send, verbatim:

> We run an open-source educational website that displays historical daily price
> charts and server-computed statistics (moving averages, RSI, MACD, volatility,
> drawdown, Sharpe, correlations, walk-forward backtests, hypothetical portfolio
> replays) for US stocks and ETFs to anonymous visitors, free of charge, with no
> forecasts and no recommendations. (1) Which plan grants the right to display
> your data and these derived series to anonymous public visitors? (2) Is
> server-side caching of end-of-day bars for 24 hours permitted on that plan?
> (3) What attribution text and placement do you require? (4) Are there per-viewer
> or exchange fees for end-of-day US equity and ETF data displayed this way?
> (5) Does your non-profit programme include external display rights, and what
> entity documentation is required?

---

## 7. Recommendation and next step

- **Keep `yfinance` local-only.** Nothing changes for local, personal use; the
  readme already says so. It must not back a public URL.
- **No provider is both affordable and clearly licensed for this use right now.**
  The lowest published display-capable price is Twelve Data Venture 610 at
  $149/mo; the only possible $0 route is Twelve Data's Non-Profit plan through a
  qualifying entity, with the assigned plan still to be confirmed in writing.
- **Do not build the integration before the written answers arrive.** The
  interface work in 2.3 is done (2026-10-03); what remains is the adapter for
  the chosen provider. The original note follows: the interface work in 2.3 (a `PriceProvider` protocol, `PRICES` /
  `PRICES_INTRADAY` capabilities, provider-driven `Quote.source`, adjustment basis
  in the payload) is provider-agnostic and can be done first; it is the exact
  next engineering step once the direction is chosen, and it also makes the
  yfinance implementation a proper provider rather than a special case.

---

## 8. Decision record (2026-10-08)

Re-verified on 2026-10-08 against the live pages: Twelve Data terms, both pricing
pages (the business page rendered in a browser so every Venture size could be
read), support articles 5332349 (commercial vs personal), 11116616 (non-profit),
12647398 (attribution), 9935903 (US equities), 5203307 (delays), 5214728
(historical data), 5179064 (adjustment), 5615854 (credits), the API docs for
`/time_series`; Tiingo's terms (revised 2026-10-06); Massive's business page and
market-data terms; Alpha Vantage's support FAQ. Labels in this section:

- **C** confirmed by published terms, pricing or docs
- **S** strongly indicated by published material, not stated outright
- **W** requires written confirmation; silence is W, never permission
- **N** not permitted by published terms

### 8.1 Decision matrix

| Question | Twelve Data Venture | Twelve Data Non-Profit | Tiingo + redistribution license | Massive Business |
|---|---|---|---|---|
| Public / external display of historical prices | **S.** Card: "External display data access"; article 5332349: business plans allow "commercial display"; terms §2.2(b) allow display to third parties "as expressly permitted by your Subscription Tier"; §2.4: tiers "may permit limited redistribution or external display ... subject to additional terms" | **S.** Programme table lists Venture, "External display data access", "for public platforms and data-driven apps"; plan assignment is Twelve Data's decision | **W.** §7.3: data "for internal consumption only"; redistribution "only available upon special request and permission, and comes with additional fees" | **S** on the $2,499 plan ("commercial and display rights"); **N** on Individual (§5(c)) |
| Charts and derived analytics displayed | **S.** §2.2(c) permits Derived Data that cannot be reverse-engineered; display of it follows the tier's display right | same | **W.** §1.6(c) (2026-10-06) prohibits "a single-security performance series, equity curve, or price path", resampled series, and "simple transformations of open, high, low, close" unless Tiingo "expressly approves it in writing for a Start-up, Enterprise, or Institutional account" | **S** on Business; **N** on Individual, which names "charts, analytics" |
| Anonymous visitors without their own key | **S.** "client-facing apps or websites"; "anonymous" and "unauthenticated" appear nowhere. Article 9935903 separates "display" (covered by standard plans) from "external distribution to users" (needs a US Equities Add-On) and defines neither; its distribution examples are brokerage, reselling, providing access to clients | same | **W** | **W** |
| Cached responses server-side | **S** for a short TTL. §2.3(g) defers to the Documentation; the Documentation recommends caching and names no timeframe; §16.1 allows retention "for duration permitted by subscription". The period itself is **W** | same | **C** on paid plans, "solely to the extent permitted by that Paid Plan" (§1.6(b)); **N** on Starter and trial plans (§1.6(a), volatile memory only) | **W** (not addressed) |
| Derived indicators publicly displayed | **S** (row 2) | same | **W** (indicator series track price; §1.6(c) allows "trading signals ... that do not expose or reproduce" the data) | **S** on Business |
| Required attribution | **C.** "Data provided by Twelve Data", dofollow link to twelvedata.com, visible near each chart or table; "Source: Twelve Data" acceptable in compact UIs (article 12647398) | **C.** The above plus the programme's recognition text naming the organisation, with a dofollow link on a prominent page, "not in the footer" (article 11116616). The supplied wording contains provider marketing language; it would be shown as Twelve Data's statement, not the project's | **C.** "Data sourced by Tiingo" with link (§7.3) | **C.** none |
| Practical rate limits | **C.** 610 / 1,597 / 2,584 API credits per minute by size; no daily limit; `/time_series` costs 1 credit per symbol; 5,000 points per request; 429 when exceeded, quota resets each minute. The explore fan-out (21 symbols) costs 21 credits | **C.** same, per assigned plan | recorded 2026-09-14; pricing page is script-rendered, not re-verified | **C.** unlimited calls |
| Actual current price | **C.** $149 / $299 / $499 per month billed monthly; $1,490 / $2,990 / $4,990 per year | **C.** $0, with an annual renewal update | $250 / $500 per month recorded 2026-09-14, not re-verified | **C.** $2,499 per month; qualifying startups 25% or more off |
| Non-profit / academic eligibility | n/a, paid | **C.** "registered as a non-profit or academic institution"; use that "does not generate revenue"; excluded: for-profit companies, paywalled or monetised projects, resellers | **W.** nothing published | **N.** nothing published; organisations are Professional Subscribers |
| CourtQuest / the organisation vs Stock Predictor | the account holder is whoever subscribes | **C.** The grant is to the registered organisation for the use described in the application ("description of your planned use"; "formal documentation of non-profit status"; recognition text reads "[Your Organisation Name] uses Twelve Data"). It would cover Stock Predictor only if Stock Predictor is described as, and genuinely is, that organisation's non-commercial initiative. Whether that is true of CourtQuest is the maintainer's call, not a research finding | account holder | account holder |
| OHLC with split and dividend adjustment | **C.** `/time_series` `adjust=all` (also `splits`, `dividends`, `none`; default `splits`) for 1day, 1week, 1month. Intraday bars are unadjusted (article 5179064) | same | **C.** adjusted OHLCV plus `divCash` and `splitFactor` | **C.** split-adjusted only; dividend factors from a separate endpoint |
| Daily and intraday ranges the app exposes | **C.** Intervals 1min to 1month on all plans, including the app's 5min and 30min. End-of-day covers "100% of total US trading volume"; the real-time intraday feed covers about 5% of US volume (article 9935903), so intraday volume is venue-partial and must be labeled as such, never shown as market volume | same | daily from 1962; intraday IEX only | **C.** minute bars on paid plans |

### 8.2 What changed since 2026-09-14

- Venture costs from **$149/mo**, not $499; the plan has three credit sizes.
- The Non-Profit programme's own plan table includes Venture with external display.
- The Documentation names no cache timeframe and recommends caching.
- Tiingo revised its terms on 2026-10-06; §1.6(c) now lists price paths and
  equity curves as prohibited derived products absent written approval.
- Twelve Data's real-time US feed is about 5% of US volume; end-of-day is 100%.
- Two shipped features sit closer to redistribution than to display and were not
  previously flagged: **CSV export of price bars** and the **open JSON API** that
  returns raw OHLCV to the browser. Both are questions below; CSV export of raw
  provider bars should be assumed **N** for a public build until answered.
- Unchanged: no free or individual tier at any provider permits public display;
  Finnhub news and FMP movers/sectors/profile still need written approval or
  replacement (Twelve Data has `/symbol_search`, `/profile`, `/market_movers`,
  and no news endpoint).

### 8.3 Smallest set of questions still needed in writing

To Twelve Data (support@twelvedata.com or sales@twelvedata.com), naming the plan
under consideration:

1. Does Venture's "External display data access" cover a free, open educational
   website whose visitors are anonymous and unauthenticated, displaying
   end-of-day and intraday price charts plus server-computed indicator series and
   statistics? Or is that "external distribution to users" requiring a
   Redistribution Rights or US Equities Add-On?
2. Is a browser-facing JSON API that returns the displayed bars to the page, and
   a CSV download of the displayed bars, within that display right? (The CSV
   export will be removed from the public build if not.)
3. What retention period applies to end-of-day bars and reference data cached
   server-side under §2.3(g), given the Documentation specifies none? Is 24 hours
   acceptable?
4. Non-Profit path only: is the applying organisation eligible for Venture for
   this use; which legal entity and documents are required; and does the grant
   cover the organisation's use generally or this project specifically?
5. Confirm the attribution wording and placement ("Data provided by Twelve Data"
   with dofollow link under each chart and table), and for the Non-Profit path
   whether the recognition text may be shortened.

Questions 1 to 3 are needed on either path; 4 only if applying as a non-profit;
5 can be settled from the published articles if they prefer.

Separately, if the market-context panels stay in a public build: Finnhub written
approval for displaying news, or removal; FMP's Data Display and Licensing
Agreement for movers, sectors and profile, or replacement.

### 8.4 Decision status

- **Provider for the public real-data path: Twelve Data.** Only provider with a
  published self-serve display tier, `adjust=all` parity with the current
  methodology, ETF coverage, documented errors, and a published non-profit
  programme that names the display tier.
- **Cheapest legitimate public-display option: Venture 610 at $149/mo.** $0 only
  if the Non-Profit programme assigns Venture and the grant letter says so.
- **Non-Profit viability:** viable on paper. It requires a registered non-profit
  as account holder, a non-commercial use, and that Stock Predictor be that
  organisation's initiative. The maintainer's notes describe CourtQuest as a
  student-led 501(c)(3); that status was not independently verified here and
  Twelve Data will ask for formal documentation. Plan assignment is at their
  discretion.
- **Status: not ready to integrate.** Blocked on written answers to 8.3 questions
  1 to 3 (either path) and 4 (non-profit path). No account created, no terms
  accepted, no plan purchased, no key issued.
- **When answers arrive:** one adapter `providers/twelvedata.py` under the
  existing `PriceProvider` contract; a venue-partial label on intraday volume; an
  attribution component near every chart and table; the CSV export decision;
  the Finnhub and FMP display decisions. None of this starts before the answers.
