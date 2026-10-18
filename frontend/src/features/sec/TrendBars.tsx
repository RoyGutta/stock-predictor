import { formatReported } from "./secFormat";

interface Bar {
  label: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD_X = 8;
const PAD_TOP = 12;
const LABEL_SPACE = 22;

/**
 * Reported values per period as bars from a zero baseline.
 *
 * Bars rather than a line: each value is a separate report for a separate
 * period, and a line would imply values between them that no filing states.
 * Losses fall below the baseline and are labelled, so sign never rests on
 * colour alone.
 */
export function TrendBars({
  bars,
  unit,
  title,
}: {
  bars: Bar[];
  unit: string;
  title: string;
}) {
  if (bars.length === 0) return null;
  const max = Math.max(0, ...bars.map((b) => b.value));
  const min = Math.min(0, ...bars.map((b) => b.value));
  const span = max - min || 1;
  const plotHeight = HEIGHT - PAD_TOP - LABEL_SPACE;
  const y = (v: number) => PAD_TOP + ((max - v) / span) * plotHeight;
  const slot = (WIDTH - PAD_X * 2) / bars.length;
  const barWidth = Math.min(48, slot * 0.6);
  const zero = y(0);
  const summary = bars
    .map((b) => `${b.label}: ${formatReported(b.value, unit)}`)
    .join("; ");

  return (
    <svg
      className="sec-trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${title} by period. ${summary}`}
    >
      <line
        className="sec-trend__axis"
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={zero}
        y2={zero}
      />
      {bars.map((bar, index) => {
        const cx = PAD_X + slot * index + slot / 2;
        const top = Math.min(zero, y(bar.value));
        const height = Math.max(1, Math.abs(y(bar.value) - zero));
        const negative = bar.value < 0;
        return (
          <g key={`${bar.label}-${index}`}>
            <rect
              className={
                negative
                  ? "sec-trend__bar sec-trend__bar--negative"
                  : "sec-trend__bar"
              }
              x={cx - barWidth / 2}
              y={top}
              width={barWidth}
              height={height}
              rx={2}
            />
            <text
              className="sec-trend__label"
              x={cx}
              y={HEIGHT - 6}
              textAnchor="middle"
            >
              {bar.label}
              {negative ? " loss" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
