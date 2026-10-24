# Analytics: dependency map, conventions, and data-quality contract

Audited 2026-10-04. This is the reference for what each number in Stock Predictor
is computed from, which conventions it follows, and what is deliberately left
undefined. Every statement here is pinned by a test named in the text.

## 1. Data flow

```
provider adapter  ->  Bar[]  (prices.validate_bars)  ->  Quote.history (Candle[])
   demo / yfinance       sorted, deduped, validated         API contract, unchanged
                                   |
                                   v
                 routes build a DataFrame indexed by date string
                                   |
     +-------------+-------------+-------------+-------------+-------------+
     v             v             v             v             v             v
 indicators   interpretation    risk       backtest      patterns     portfolio
 (pure)       (reads           (returns-   (positions    (trailing    (flow-adjusted
              indicators)      based)      lagged 1 bar) baselines)   returns)
                                   |
                           compare / explore
                    (risk functions over several tickers)
```

Nothing below the `Bar[]` boundary knows a vendor (`test_architecture.py`).

## 2. Frequency and annualization: one source

`providers/prices.py` holds the only range-to-frequency table:

| Range | Bars | Annualized as |
|---|---|---|
| 1D | 5-minute | never |
| 5D | 30-minute | never |
| 1M, 3M, 6M, 1Y | daily | 252 periods/year |
| 5Y | weekly (resampled from daily) | 52 |
| MAX | monthly (resampled from daily) | 12 |

Intraday bars are not annualized anywhere: the analysis route returns `risk:
null` for 1D and 5D, and the backtest, compare, and portfolio routes refuse those
ranges with a 422 that says why (`test_intraday_annualization.py`). Before this
audit every route fell back to "daily" for unlisted ranges, which would have
scaled 5-minute returns by sqrt(252), an error of roughly sqrt(78). Routes no
longer keep private frequency tables (`test_no_route_keeps_a_private_frequency_table`).

Weekly and monthly bars are built by `prices.resample_bars` for every provider:
open = first open, high = max, low = min, close = last close, volume = sum, and
the bar's date is the **last trading day it contains** (so "as of" is never a
Monday for a bar that holds Friday's close). The yfinance adapter now fetches
daily bars and resamples them rather than taking Yahoo's own 1wk/1mo bars, whose
dates are period starts (`test_yfinance_adapter_resamples_weekly_and_monthly_from_daily`).

## 3. Indicator conventions

| Indicator | Definition used | Warm-up | Notes |
|---|---|---|---|
| SMA | rolling mean, `min_periods=period` | NaN for the first `period-1` bars | |
| EMA | `ewm(span, adjust=False)`, seeded from the first value | NaN until `period` values | Recursive seed, not an SMA seed; deliberate and tested |
| RSI, ATR, ADX | Wilder smoothing `alpha = 1/period` | `period` | Not a standard EMA; wrong otherwise |
| RSI edge cases | all gains: 100; all flat: NaN (undefined, not 100) | | `test_rsi_distinguishes_saturation_from_undefined` |
| MACD | EMA(fast) - EMA(slow); signal = EMA of that | | |
| Bollinger | SMA +/- N * population std (`ddof=0`) | | Original definition |
| Stochastic | %K over the high-low range, flat window undefined | | |
| OBV | cumulative signed volume | | level arbitrary; direction only |
| VWAP | cumulative from the first bar | | meaningful intraday only |
| Ichimoku | spans shifted forward by `base_period` (past data); lagging line is `close.shift(-26)` | | The lagging line is the one non-causal output by definition; it is display-only and no analytical module reads it |

Two invariants hold for every indicator at once (`test_indicators.py`): removing
future bars, or multiplying every future bar by 0.2, changes nothing already
computed; and bounded oscillators and ratios (RSI, Stochastic, ADX, +DI/-DI,
Bollinger bandwidth, OBV) are unchanged when prices are scaled by 1000, while
price-level outputs scale linearly.

## 4. Risk conventions

- Returns are simple period returns; Monte Carlo resamples log returns.
- Annualized return is the CAGR over the window (`growth ** (periods/n) - 1`), a
  realized figure, never an expectation.
- Volatility uses the sample standard deviation (`ddof=1`), scaled by `sqrt(periods)`.
- Sharpe de-annualizes the risk-free rate per period; zero variance is NaN, not 0.
- Sortino divides shortfalls by the full sample length; a sample with no losing
  period is NaN, never infinite.
- Drawdown is positional and tolerates repeated index labels.
- Beta reports R-squared beside it and inner-joins calendars; fewer than three
  overlapping points is NaN.
- Every NaN serializes as `null`. A missing statistic is never 0.
- Drawdown duration (`risk.underwater`, cycle 13): a spell is a run of consecutive
  closes below the running peak; its length counts those bars. A spell still open
  at the window's end is reported with `longest_underwater_recovered = false` and
  shown as "N+ bars", because its true length is at least N. Current drawdown is
  the last close against the window's highest close; time underwater is the share
  of bars below the running peak. Highs are measured inside the window only.
  Pinned: recovery, open spell, latest-peak date, monotonic rise, share, scale
  invariance, empty input. Cycle 14 added known-answer series (a recovered and an
  open spell of equal length: the earlier one is reported), recovery at exactly the
  prior high, and missing closes, which are dropped rather than allowed to poison
  the running peak. Durations count bars, not calendar days.

## 5. Backtest guarantees

Positions take effect one bar after the signal; costs are charged on every change
in exposure; buy-and-hold is always reported; parameters are chosen on the first
60 percent and scored on the rest. New in this audit (`test_backtest.py`): for
every strategy and every grid parameter, truncating the series leaves every
earlier equity value unchanged, and multiplying every future price by 5 leaves
the equity curve before the cutoff identical; a signal that knows tomorrow's
direction earns exactly what its one-bar-lagged copy earns, never the oracle's
return.

## 6. Pattern guarantees

Detection uses only bars at or before the event; the large-move baseline ends
one bar earlier; outcome windows start strictly after the event; boundary
events are excluded and counted; zero samples are `null`; samples under ten are
flagged. New (`test_patterns.py`): a fixture that exercises all ten detectors,
truncation causality per detector, and a direct recomputation of every outcome
window's sample size, exclusion count, and mean.

## 7. Portfolio guarantees

Fixed weights, no rebalancing, costs on every purchase, benchmark receives the
identical cash flows, statistics on the flow-adjusted return series
`r_t = (V_t - flow_t) / V_{t-1} - 1`. New (`test_portfolio.py`): flat prices with
monthly deposits yield a return made only of the 10 bps costs and an ending value
equal to deposits minus costs to the cent; a 90 percent price collapse shows the
same return and drawdown with or without large monthly deposits.

## 8. Data-quality contract (`prices.validate_bars`)

Applied to every provider's bars before anything else sees them
(`test_data_quality.py`).

Normalized, deterministically and without losing information:

- unsorted bars are sorted by timestamp (stable);
- repeated timestamps keep the **last** bar, the same rule `risk` and `patterns`
  use, so no module can disagree with another;
- a high below the open or close, or a low above them, is widened to bracket
  them (rounding noise in real feeds); the close is never changed; it is logged.

Rejected, as a whole series, with a 502 that names the provider and the reason:

- any non-finite open, high, low, or close;
- any zero or negative price;
- a high below the low;
- a negative volume.

Missing bars stay missing; nothing is interpolated. The old test fixtures that
reused 28 calendar dates for 300 candles were themselves the first thing this
rule caught.

## 9. Timestamps

- Date-only strings (`YYYY-MM-DD`) are calendar days. The frontend builds them as
  local dates; parsing them as UTC midnight shifted every daily bar a day earlier
  in US Eastern time, which is why the frontend test suite is now pinned to
  `America/New_York` (`vitest.config.ts`).
- Intraday timestamps from the demo are naive session times (`09:30` to `15:55`,
  US Eastern by construction, no offset); yfinance intraday timestamps carry
  their offset. Both parse correctly in the frontend.
- Weekly and monthly bars: see section 2.
- Duplicate timestamps: see section 8.
- The demo dataset is frozen at 2025-12-31 and versioned (`DATASET_VERSION`);
  golden bars for four tickers and ranges pin the generator
  (`test_golden_bars_pin_the_generator`).

## 10. Performance (demo data, warm caches, local)

Analysis 13 ms (interpretation 2.6, series 2.2, risk 0.6, momentum 0.3), MAX
analysis 20 ms, patterns 7 ms, backtest 32 ms, simulation 21 ms, compare 13 ms,
portfolio 17 ms, explore 38 ms for 21 securities. Indicators are computed twice
in the analysis route (once for interpretation, once for the plotted series);
that duplication costs about 5 ms and is left alone deliberately.

## 11. Reported fundamentals (`analytics/fundamentals.py`, cycle 13)

Source: SEC XBRL company facts. Pure functions; every rule below is a test in
`backend/tests/test_sec_fundamentals.py`.

| Rule | Why |
|---|---|
| Period type comes from the fact's own start and end: annual 350-380 days, quarterly 80-100 days | `fy`/`fp` describe the filing, not the fact; a 10-K carries quarterly facts |
| Year-to-date durations (about 180 and 270 days) are excluded, never converted | Converting needs facts from different filings |
| No fourth quarter is derived (annual minus nine months) | Same reason; the quarterly view has a gap instead |
| One value per period: latest filing wins; `revised` and the first-reported value are kept when filings disagree | Amendments and restatements take effect, visibly |
| Only periodic reports (10-K, 10-Q, 20-F, 40-F, transition and amended forms) | Registration statements also carry facts |
| Units must match exactly (USD, USD/shares); others are named in `ignored_units` | No currency conversion |
| Revenue merges successive tags of one concept, by priority; every other metric uses one tag per series | Revenue's tag changed in 2018; cash with and without restricted cash is not one concept |
| Year over year compares with the period ending 350-380 days earlier; percent withheld when the earlier value is zero or negative; a note when period lengths differ by more than 3 days | 53-week years and losses |
| Missing measure: `points: []` plus a reason in words; never 0 | Hard constraint 13 |
| One value per period end within a view: when two periods of the same kind end on the same day with different starts (a fiscal-calendar change), the later filing wins and the replaced one is named in `period_conflicts` (cycle 14) | One column per period end; previously the survivor was arbitrary |

Derived (`analytics/fundamentals_derived.py`): gross, operating and net margin;
free cash flow (operating cash flow minus capex); liabilities / assets. Computed
only when both components cover the identical period and come from the same
filing; both components are returned with each value. Cycle 14 adversarial tests
pin that a quarter is never paired with a year-to-date figure ending the same day,
that a 365-day and a 366-day period ending together are not paired, that a
component in a different unit blocks the ratio rather than being converted, and
that a quarter is never compared year over year with an annual figure. Ratio changes are given in
percentage points, never as a percent of a percent.

## 12. Treasury yield curve (`analytics/yield_curve.py`, cycle 15)

| Rule | Detail |
|---|---|
| Observation date | Treasury's `NEW_DATE`, a business day; shown apart from the retrieval time. Weekends and holidays are never filled in |
| Missing | Absent element, `m:null="true"`, empty, or `N/A` is `None`. Unparseable or outside -5..30 percent is rejected, reported, and `None`. Never 0, never interpolated; chart lines break at gaps |
| Duplicates | Same date twice: the higher Treasury record `Id` wins; reported |
| Spreads | 10y-2y and 10y-3m = long minus short on the same day, rounded to 2 decimals (Treasury publishes 2); basis points = points x 100, rounded to whole bp |
| One-month change | Latest observation against the last published day on or before latest - 30 calendar days, only if within 7 days of that target; otherwise no comparison |
| Shape | From 10y-3m: below 0 inverted (standard definition); 0 to under 0.50 points comparatively flat; 0.50 and above upward sloping. The 0.50 boundary is this application's convention and is stated in the UI |
| Incomplete curve | Any of 1M, 3M, 6M, 1Y, 2Y, 5Y, 10Y, 30Y missing is listed; the rest are shown |

Descriptive only: no forecast, no link to the synthetic stock prices, and the UI
states that inversions have not always been followed by recessions.

## 13. Money Manager ledger (`frontend/src/features/money/ledger.ts`, cycle 15)

Pure TypeScript, run in the browser. Every rule is in `ledger.test.ts`.

| Rule | Detail |
|---|---|
| Units | Integer cents throughout; no floating-point money |
| Sign | Natural balances: assets = held, liabilities = owed, both normally >= 0. Transaction amounts positive; `valuation` carries a signed change |
| Opening balance | Balance at the start of `opening_date`; never income. Transactions dated earlier count in income/spending reports but not in the balance, and are flagged |
| Income / spending | Income = `income`. Spending = `expense` + interest portion of debt payments - `refund`. Transfers and valuations are neither |
| Transfers | Conserve net worth (200 random cases pinned). A payment to a debt may carry `interest_cents`: only principal reduces the debt; interest is spending |
| Cards | A card purchase is spending once, when charged; paying the card is a transfer |
| Pending | Excluded from balances and flows until settled; counted and shown |
| Currency | Only USD enters totals; other currencies listed as excluded |
| Months | Complete calendar months only; months before the earliest account start are not shown (not zeros) |
| Ratios | Debts / assets (null without assets); recorded minimum payments / average monthly income over the last 3 complete months with activity (debts without a minimum are named as excluded); liquid funds / average monthly spending. Null, never 0, when inputs are missing |
| Payoff | Monthly: interest = round(balance x APR / 12), then payment. Infeasible when the payment does not exceed the first month's interest. No APR or payment means no estimate. Known answer: $10,000 at 6% clears in 120 payments of $111.03 |
| Reconciliation | Statement balance minus recorded balance on a date |
