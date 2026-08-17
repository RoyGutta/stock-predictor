import { Callout, Card, Skeleton } from "../../components/ui";
import { formatRatio } from "../../lib/format";
import type { CorrelationResponse } from "../../types/market";
import "./simulation.css";

/**
 * Tint by strength and sign.
 *
 * Correlation is signed, so the two directions get different hues rather than
 * one ramp — and the number is always printed in the cell, because a reader
 * must never have to infer a value from a shade alone.
 */
function cellTint(value: number | null): string {
  if (value === null) return "transparent";
  const base = value >= 0 ? "var(--down)" : "var(--up)";
  // High correlation is the *risk* case here (things fall together), so it
  // reads in the warning hue rather than the reassuring one.
  const intensity = Math.min(Math.abs(value), 1) * 26;
  return `color-mix(in srgb, ${base} ${intensity.toFixed(0)}%, transparent)`;
}

function plainReading(value: number | null): string {
  if (value === null) return "not computable";
  if (value >= 0.8) return "moved almost identically";
  if (value >= 0.5) return "moved together often";
  if (value >= 0.2) return "moved together loosely";
  if (value > -0.2) return "moved close to independently";
  if (value > -0.5) return "moved opposite loosely";
  return "moved opposite often";
}

interface CorrelationPanelProps {
  data: CorrelationResponse | null;
  loading: boolean;
  error: string | null;
}

const TITLE = "Do these move together?";

export function CorrelationPanel({ data, loading, error }: CorrelationPanelProps) {
  if (error) {
    return (
      <Card title={TITLE}>
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title={TITLE}>
        <Skeleton height={180} />
      </Card>
    );
  }

  const { tickers, matrix } = data;
  const unavailable = Object.entries(data.unavailable);

  return (
    <Card title={TITLE} action={<span className="eyebrow">{data.observations} observations</span>}>
      <p className="corr-lede">
        Holding several things that all move together is far less diversified than it looks.
        A high number below means those two rose and fell largely as one.
      </p>

      <div className="corr-scroll">
        <table className="corr-table">
          <caption className="visually-hidden">
            Pairwise return correlation between {tickers.join(", ")} over {data.range}.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Ticker</span>
              </th>
              {tickers.map((ticker) => (
                <th key={ticker} scope="col" className="corr-table__head">
                  {ticker}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((rowTicker, row) => (
              <tr key={rowTicker}>
                <th scope="row" className="corr-table__head" title={data.resolved[rowTicker]}>
                  {rowTicker}
                </th>
                {tickers.map((colTicker, col) => {
                  const value = matrix[row]?.[col] ?? null;
                  const self = row === col;
                  return (
                    <td
                      key={colTicker}
                      className={`corr-table__cell numeric${self ? " corr-table__cell--self" : ""}`}
                      style={{ background: self ? undefined : cellTint(value) }}
                      title={
                        self
                          ? `${rowTicker} against itself`
                          : `${rowTicker} and ${colTicker} ${plainReading(value)}`
                      }
                    >
                      {formatRatio(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unavailable.length > 0 && (
        <Callout tone="note">
          <div>
            {unavailable.map(([ticker, reason]) => (
              <p key={ticker} className="sim-method">
                <strong>{ticker}</strong> was left out: {reason}
              </p>
            ))}
          </div>
        </Callout>
      )}

      <p className="risk__basis">{data.note}</p>
    </Card>
  );
}
