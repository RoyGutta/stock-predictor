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
