import { Card, Stat } from "../../components/ui";
import { formatPercent, formatPercentPlain, formatRatio } from "../../lib/format";
import type { BenchmarkComparison, RiskMetrics } from "../../types/market";
import "./analysis.css";

function formatRecovery(risk: RiskMetrics): string {
  if (!risk.drawdown_trough_date) return "";
  return risk.drawdown_recovery_date
    ? `Recovered ${risk.drawdown_recovery_date}`
    : "Had not recovered by the end of this period";
}

/**
 * Risk statistics for the selected range.
 *
 * Every figure that could not be computed renders as an em dash rather than 0,
 * and each carries a glossary definition — these are the numbers a beginner is
 * most likely to misread.
 */
export function RiskPanel({ risk }: { risk: RiskMetrics }) {
  return (
    <Card title="Risk over this period" action={<span className="eyebrow">Measured, not predicted</span>}>
      <div className="risk-grid">
        <Stat
          label="Volatility"
          term="volatility"
          value={formatPercentPlain(risk.annualized_volatility)}
          note="Annualized"
        />
        <Stat
          label="Max drawdown"
          term="drawdown"
          value={formatPercentPlain(risk.max_drawdown)}
          tone={risk.max_drawdown != null && risk.max_drawdown < 0 ? "negative" : undefined}
          note={formatRecovery(risk)}
        />
        <Stat
          label="Sharpe ratio"
          term="sharpe"
          value={formatRatio(risk.sharpe_ratio)}
          note="Return per unit of volatility"
        />
        <Stat
          label="Sortino ratio"
          term="sortino"
          value={formatRatio(risk.sortino_ratio)}
          note="Downside risk only"
        />
        <Stat
          label="Value at risk"
          term="valueAtRisk"
          value={formatPercent(risk.value_at_risk_95)}
          note="Worst 1 day in 20"
        />
        <Stat
          label="Expected shortfall"
          term="conditionalValueAtRisk"
          value={formatPercent(risk.conditional_value_at_risk_95)}
          note="Average of those worst days"
        />
        <Stat
          label="Return"
          value={formatPercent(risk.annualized_return)}
          tone={
            risk.annualized_return == null
              ? undefined
              : risk.annualized_return >= 0
                ? "positive"
                : "negative"
          }
          note="Annualized, this period"
        />
      </div>

      {risk.benchmark && <BenchmarkRow benchmark={risk.benchmark} />}

      <p className="risk__basis">
        {risk.basis} Based on {risk.observations} {risk.frequency} observations.
      </p>
    </Card>
  );
}

/**
 * Beta against the market, with R-squared beside it rather than beneath it.
 *
 * A beta computed from a relationship the benchmark barely explains is close
 * to meaningless, and quoting beta alone is the standard way that gets hidden.
 * When R-squared is low this says so in words, because the reader most likely
 * to misuse beta is the one least likely to know what R-squared is.
 */
function BenchmarkRow({ benchmark }: { benchmark: BenchmarkComparison }) {
  const { beta, r_squared: rSquared, benchmark_ticker: ticker } = benchmark;
  const weak = rSquared != null && rSquared < 0.3;

  return (
    <div className="risk-benchmark">
      <div className="risk-grid">
        <Stat
          label={`Beta vs ${ticker}`}
          term="beta"
          value={formatRatio(beta)}
          note={
            beta == null
              ? "Not computable over this window"
              : `Moved about ${formatRatio(Math.abs(beta))}× the market`
          }
        />
        <Stat
          label="Explained by market"
          value={rSquared == null ? formatRatio(null) : formatPercentPlain(rSquared)}
          note={`R² against ${ticker}`}
        />
      </div>
      {weak && (
        <p className="risk__basis">
          The market explains only {formatPercentPlain(rSquared)} of this stock&rsquo;s
          movement over this window, so the beta above rests on a weak relationship and
          should not be leaned on. Most of what moved this price was specific to it.
        </p>
      )}
    </div>
  );
}
