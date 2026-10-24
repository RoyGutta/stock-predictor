import type { CurvePoint } from "../../types/treasury";
import { formatYield } from "./treasuryFormat";

const W = 640;
const H = 220;
const PAD = { left: 44, right: 12, top: 14, bottom: 30 };

interface Props {
  curve: CurvePoint[];
  date: string;
  comparisonDate: string | null;
}

/** Split a series into runs of consecutive non-null points: gaps stay gaps. */
function segments(values: (number | null)[]): { i: number; v: number }[][] {
  const out: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length) out.push(run);
      run = [];
    } else {
      run.push({ i, v });
    }
  });
  if (run.length) out.push(run);
  return out;
}

/**
 * The par yield curve across maturities, with the comparison date's curve
 * dashed behind it. Maturities are evenly spaced (not to time scale) so the
 * short end stays readable; the axis labels name each one. A missing maturity
 * breaks the line rather than being bridged by an invented value.
 */
export function YieldCurveChart({ curve, date, comparisonDate }: Props) {
  const latest = curve.map((p) => p.value);
  const prior = curve.map((p) => p.prior_value);
  const all = [...latest, ...prior].filter((v): v is number => v != null);
  if (all.length === 0) return null;

  const lo = Math.floor((Math.min(...all) - 0.1) * 4) / 4;
  const hi = Math.ceil((Math.max(...all) + 0.1) * 4) / 4;
  const span = hi - lo || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left +
    (curve.length === 1 ? plotW / 2 : (i / (curve.length - 1)) * plotW);
  const y = (v: number) => PAD.top + ((hi - v) / span) * plotH;
  const ticks = [lo, lo + span / 2, hi];
  const path = (run: { i: number; v: number }[]) =>
    run
      .map(
        (p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`,
      )
      .join(" ");

  const described = curve
    .filter((p) => p.value != null)
    .map((p) => `${p.label} ${formatYield(p.value)}`)
    .join(", ");

  return (
    <svg
      className="ust-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Treasury par yield curve on ${date}: ${described}. The table below lists every value.`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            className="ust-chart__grid"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
          />
          <text
            className="ust-chart__tick"
            x={PAD.left - 6}
            y={y(t) + 4}
            textAnchor="end"
          >
            {t.toFixed(2)}%
          </text>
        </g>
      ))}
      {comparisonDate &&
        segments(prior).map((run, k) => (
          <path
            key={`p${k}`}
            className="ust-chart__line ust-chart__line--prior"
            d={path(run)}
          />
        ))}
      {segments(latest).map((run, k) => (
        <path key={`l${k}`} className="ust-chart__line" d={path(run)} />
      ))}
      {latest.map((v, i) =>
        v == null ? null : (
          <circle
            key={curve[i].key}
            className="ust-chart__dot"
            cx={x(i)}
            cy={y(v)}
            r={3}
          />
        ),
      )}
      {curve.map((p, i) => (
        <text
          key={p.key}
          className="ust-chart__tick"
          x={x(i)}
          y={H - 10}
          textAnchor="middle"
        >
          {p.label.replace(" Mo", "m").replace(" Yr", "y")}
        </text>
      ))}
    </svg>
  );
}
