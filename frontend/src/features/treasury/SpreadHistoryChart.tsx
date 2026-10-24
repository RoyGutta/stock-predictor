import type { YieldCurveResponse } from "../../types/treasury";
import { formatObservationDate } from "./treasuryFormat";

const W = 640;
const H = 170;
const PAD = { left: 44, right: 12, top: 12, bottom: 24 };

type Row = YieldCurveResponse["history"][number];

const SERIES = [
  { key: "spread_10y_2y" as const, label: "10-year minus 2-year", cls: "" },
  {
    key: "spread_10y_3m" as const,
    label: "10-year minus 3-month",
    cls: " ust-chart__line--second",
  },
];

function range(rows: Row[], key: (typeof SERIES)[number]["key"]) {
  const values = rows.map((r) => r[key]).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Both spreads over the published days in the history window, with a zero
 * line: below it the curve is inverted on that measure. Only published days
 * are plotted, evenly spaced, so weekends and holidays are not drawn as data.
 */
export function SpreadHistoryChart({ rows }: { rows: Row[] }) {
  if (rows.length < 2) return null;
  const values = rows
    .flatMap((r) => [r.spread_10y_2y, r.spread_10y_3m])
    .filter((v): v is number => v != null);
  if (values.length === 0) return null;
  const lo = Math.min(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10);
  const hi = Math.max(0, Math.ceil((Math.max(...values) + 0.05) * 10) / 10);
  const span = hi - lo || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (rows.length - 1)) * plotW;
  const y = (v: number) => PAD.top + ((hi - v) / span) * plotH;

  const summary = SERIES.map((s) => {
    const r = range(rows, s.key);
    return r
      ? `${s.label} ranged from ${r.min.toFixed(2)} to ${r.max.toFixed(2)} points`
      : "";
  })
    .filter(Boolean)
    .join("; ");
  const first = formatObservationDate(rows[0].date);
  const last = formatObservationDate(rows[rows.length - 1].date);

  return (
    <figure className="ust-history">
      <svg
        className="ust-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Spreads from ${first} to ${last}: ${summary}.`}
      >
        {[hi, 0, lo]
          .filter((t, i, a) => a.indexOf(t) === i)
          .map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? "ust-chart__zero" : "ust-chart__grid"}
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
                {t.toFixed(1)}
              </text>
            </g>
          ))}
        {SERIES.map((s) => {
          let d = "";
          let pen = false;
          rows.forEach((r, i) => {
            const v = r[s.key];
            if (v == null) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
            pen = true;
          });
          return (
            <path
              key={s.key}
              className={`ust-chart__line${s.cls}`}
              d={d.trim()}
            />
          );
        })}
        <text className="ust-chart__tick" x={PAD.left} y={H - 6}>
          {first}
        </text>
        <text
          className="ust-chart__tick"
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
        >
          {last}
        </text>
      </svg>
      <figcaption className="ust-note">
        Percentage points, {rows.length} published days. Below the zero line the
        curve is inverted on that measure. {summary}.
      </figcaption>
    </figure>
  );
}
