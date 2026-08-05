import { InfoTip } from "../../components/ui";
import { SERIES_COLORS, type ChartOptions } from "./chartConfig";
import "./chart.css";

interface ChartControlsProps {
  options: ChartOptions;
  onChange: (options: ChartOptions) => void;
}

/**
 * Indicator toggles double as the chart legend: each swatch matches its line,
 * so there is nothing separate to cross-reference.
 *
 * Deliberately kept out of PriceChart.tsx — that module imports Recharts and is
 * lazy-loaded, and importing these controls from it would pull the whole
 * charting library back into the initial bundle.
 */
const TOGGLES = [
  { key: "showSMA", label: "SMA", color: SERIES_COLORS.sma, term: "movingAverage" },
  { key: "showEMA", label: "EMA", color: SERIES_COLORS.ema, term: "movingAverage" },
  { key: "showBollinger", label: "Bollinger", color: SERIES_COLORS.bollinger, term: "bollinger" },
  { key: "showVolume", label: "Volume", color: SERIES_COLORS.volume, term: "volume" },
] as const;

export function ChartControls({ options, onChange }: ChartControlsProps) {
  return (
    <div className="chart__controls">
      {TOGGLES.map(({ key, label, color, term }) => (
        <label key={key} className="chart__toggle">
          <input
            type="checkbox"
            checked={options[key]}
            onChange={() => onChange({ ...options, [key]: !options[key] })}
          />
          <span className="chart__swatch" style={{ background: color }} aria-hidden="true" />
          {label}
          <InfoTip term={term} />
        </label>
      ))}

      <label className="chart__period">
        Period
        <input
          type="number"
          min={2}
          max={200}
          value={options.period}
          onChange={(event) =>
            onChange({
              ...options,
              period: Math.min(200, Math.max(2, Number(event.target.value) || 2)),
            })
          }
        />
      </label>
    </div>
  );
}
