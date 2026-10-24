import { Card, Stat } from "../../components/ui";
import { formatPercent, formatPercentPlain, formatRatio } from "../../lib/format";
import type { BenchmarkComparison, RiskMetrics } from "../../types/market";
import "./analysis.css";

const BAR_UNITS: Record<string, string> = {
  daily: "trading days",
  weekly: "weeks",
  monthly: "months",
};

function formatSpell(risk: RiskMetrics): { value: string; note: string } {
  const bars = risk.longest_underwater_bars;
  if (bars == null) return { value: formatRatio(null), note: "" };
  if (bars === 0) return { value: "None", note: "Never closed below an earlier high" };
  const unit = BAR_UNITS[risk.frequency] ?? "bars";
  if (risk.longest_underwater_recovered === false) {
    return {
      value: `${bars}+ ${unit}`,
      note: `Since ${risk.longest_underwater_start}; still below that high when the period ends`,
    };
  }
  return {
    value: `${bars} ${unit}`,
    note: `${risk.longest_underwater_start} high, regained ${risk.longest_underwater_end}`,
  };
}

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
  const spell = formatSpell(risk);
  const hasDuration = risk.longest_underwater_bars != null;
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
        {hasDuration && (
          <>
            <Stat
              label="Below its high now"
              term="currentDrawdown"
              value={formatPercentPlain(risk.current_drawdown)}
              tone={
                risk.current_drawdown != null && risk.current_drawdown < 0 ? "negative" : undefined
              }
              note={
                risk.current_drawdown === 0
                  ? "Closed at this period's high"
                  : `High set ${risk.current_drawdown_peak_date ?? "in this period"}`
              }
            />
            <Stat
              label="Longest time below a high"
              term="timeBelowHigh"
              value={spell.value}
              note={spell.note}
            />
            <Stat
              label="Time spent below a high"
              term="timeBelowHigh"
              value={formatPercentPlain(risk.time_underwater)}
              note="Share of this period's closes"
            />
          </>
        )}
      </div>

      {risk.benchmark && <BenchmarkRow benchmark={risk.benchmark} />}

      <p className="risk__basis">
        {risk.basis} Based on {risk.observations} {risk.frequency} observations.
        {hasDuration &&
          " Highs are measured inside this range only: a peak set before it began is not seen, so a longer range can show a deeper, longer drawdown."}
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
