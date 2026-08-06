import { Card, Stat } from "../../components/ui";
import { formatPercent, formatPercentPlain, formatRatio } from "../../lib/format";
import type { RiskMetrics } from "../../types/market";
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

      <p className="risk__basis">
        {risk.basis} Based on {risk.observations} {risk.frequency} observations.
      </p>
    </Card>
  );
}
