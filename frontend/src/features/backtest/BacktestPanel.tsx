import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { formatPercentPlain, formatRatio } from "../../lib/format";
import type { BacktestResponse, StrategyResult } from "../../types/market";
import "./backtest.css";

/**
 * One rule's result.
 *
 * The in-sample and out-of-sample figures sit side by side with an arrow
 * between them, because the *gap* is the point. A rule that looked excellent on
 * the data used to choose its settings and then collapsed on data it had never
 * seen is the single most useful thing a beginner can be shown about trading
 * rules — so the layout makes that collapse the most visible element.
 */
function StrategyRow({ result }: { result: StrategyResult }) {
  const isBenchmark = result.strategy_key === "buy_and_hold";
  const { in_sample: inSample, out_of_sample: outOfSample } = result;
  const overfit = result.degradation < -0.05 && !isBenchmark;

  return (
    <li className={`bt-row${isBenchmark ? " bt-row--benchmark" : ""}`}>
      <div className="bt-row__head">
        <div>
          <h3 className="bt-row__name">
            {result.strategy_name}
            {isBenchmark && <span className="bt-row__tag">benchmark</span>}
          </h3>
          <p className="bt-row__description">{result.description}</p>
        </div>
        {!isBenchmark && (
          <span
            className={`bt-row__verdict-chip bt-row__verdict-chip--${
              result.beat_benchmark ? "ahead" : "behind"
            }`}
          >
            {result.beat_benchmark ? "Ahead of" : "Behind"} buy &amp; hold
          </span>
        )}
      </div>

      <div className="bt-journey">
        <div className="bt-journey__stage">
          <span className="eyebrow">Tuned on this</span>
          <span className="bt-journey__value numeric">
            {formatPercentPlain(inSample.total_return)}
          </span>
          <span className="bt-journey__note">
            {inSample.bars} bars
            {!isBenchmark && (
              <>
                {" "}· picked {result.parameter_label} = {result.chosen_parameter} from{" "}
                {result.parameters_tried} tried
              </>
            )}
          </span>
        </div>

        <span className="bt-journey__arrow" aria-hidden="true">
          →
        </span>

        <div className="bt-journey__stage bt-journey__stage--result">
          <span className="eyebrow">Then tested on unseen data</span>
          <span
            className={`bt-journey__value numeric${
              outOfSample.total_return === 0
                ? ""
                : ` bt-journey__value--${outOfSample.total_return > 0 ? "positive" : "negative"}`
            }`}
          >
            {formatPercentPlain(outOfSample.total_return)}
          </span>
          <span className="bt-journey__note">
            {outOfSample.bars} bars · {outOfSample.trades} trade
            {outOfSample.trades === 1 ? "" : "s"} ·{" "}
            {formatPercentPlain(outOfSample.exposure)} of the time invested
          </span>
        </div>
      </div>

      {outOfSample.trades === 0 && !isBenchmark && (
        <p className="bt-row__overfit">
          This rule never triggered during the test period, so it sat in cash and returned
          nothing. That is a result, not a missing value.
        </p>
      )}

      {overfit && (
        <p className="bt-row__overfit">
          Dropped {formatPercentPlain(Math.abs(result.degradation))} from the period used to
          choose its settings. That gap is what over-fitting looks like.
        </p>
      )}

      <dl className="bt-stats">
        <div>
          <dt>vs buy &amp; hold</dt>
          {/* Zero is neither ahead nor behind: no sign, no color (L-8). */}
          <dd
            className={`numeric ${
              result.excess_return > 0
                ? "bt-positive"
                : result.excess_return < 0
                  ? "bt-negative"
                  : ""
            }`}
          >
            {result.excess_return > 0 ? "+" : result.excess_return < 0 ? "−" : ""}
            {Math.abs(result.excess_return * 100).toFixed(1)}pp
          </dd>
        </div>
        <div>
          <dt>Worst drop</dt>
          <dd className="numeric">{formatPercentPlain(outOfSample.max_drawdown)}</dd>
        </div>
        <div>
          <dt>Sharpe</dt>
          <dd className="numeric">{formatRatio(outOfSample.sharpe_ratio)}</dd>
        </div>
        <div>
          <dt>Cost drag</dt>
          <dd className="numeric">−{formatPercentPlain(outOfSample.cost_drag)}</dd>
        </div>
      </dl>

      <p className="bt-row__verdict">{result.verdict}</p>
    </li>
  );
}

interface BacktestPanelProps {
  data: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  ticker: string;
  onRun: () => void;
  started: boolean;
}

export function BacktestPanel({
  data,
  loading,
  error,
  ticker,
  onRun,
  started,
}: BacktestPanelProps) {
  if (!started) {
    return (
      <Card title="Would a trading rule have beaten just holding?">
        <div className="bt-intro">
          <p className="bt-intro__body">
            Common rules like &ldquo;buy when RSI is low&rdquo; are tested on {ticker}&rsquo;s price
            history. Each rule&rsquo;s settings are chosen using an early stretch of data, then
            scored once on a later stretch it never saw — the same way you would find out
            whether a rule works, rather than whether it can be made to look good in
            hindsight.
          </p>
          <Button variant="primary" onClick={onRun}>
            Run the test
          </Button>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Would a trading rule have beaten just holding?">
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title="Would a trading rule have beaten just holding?">
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={120} />
          ))}
        </div>
      </Card>
    );
  }

  const tested = data.strategies.length - 1; // exclude the benchmark itself

  return (
    <Card
      title="Would a trading rule have beaten just holding?"
      action={<span className="eyebrow">Walk-forward test</span>}
    >
      <p className="bt-headline">
        <strong>
          {data.strategies_beating_benchmark} of {tested}
        </strong>{" "}
        rules finished ahead of simply buying and holding {data.ticker} over the period they
        had never seen.
      </p>

      <p className="bt-subhead">
        {data.bars} bars, split at {data.split_date}. Transaction costs of {data.cost_bps} basis
        points are charged on every trade.
      </p>

      <ul className="bt-list">
        {data.strategies.map((result) => (
          <StrategyRow key={result.strategy_key} result={result} />
        ))}
      </ul>

      <Callout tone="accent">
        <div>
          <p className="bt-method">{data.method}</p>
          <p className="bt-method bt-method--warn">{data.disclaimer}</p>
        </div>
      </Callout>
    </Card>
  );
}
