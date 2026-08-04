import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError, fetchQuote } from "./lib/api";
import { bollingerBands, downsample, ema, sma } from "./lib/indicators";
import { INTRADAY_RANGES, RANGES, type Candle, type Quote, type Range } from "./types/market";
import "./App.css";

/** Ceiling on points rendered — Recharts degrades badly past a few thousand. */
const MAX_CHART_POINTS = 1000;

interface ChartPoint extends Candle {
  ma?: number;
  ema?: number;
  upperBollinger?: number;
  lowerBollinger?: number;
  prevPrice?: number;
}

function formatTimestamp(iso: string, intraday: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return intraday
    ? date.toLocaleString(undefined, {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function App() {
  const [tickerInput, setTickerInput] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [range, setRange] = useState<Range>("1M");
  const [history, setHistory] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chart options
  const [showPrice, setShowPrice] = useState(true);
  const [showMA, setShowMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [maPeriod, setMAPeriod] = useState(20);
  const [darkMode, setDarkMode] = useState(true);

  // Cancels the previous request when a new one starts, so a slow response for
  // an old ticker can't overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadQuote = useCallback(
    async (symbol: string, selectedRange: Range) => {
      const trimmed = symbol.trim();
      if (!trimmed) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setLoading(true);
      setError(null);
      try {
        const result = await fetchQuote(trimmed, selectedRange, controller.signal);
        setQuote(result);
        setHistory((prev) => [result, ...prev.filter((item) => item.ticker !== result.ticker)]);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQuote(null);
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      } finally {
        if (inFlight.current === controller) setLoading(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void loadQuote(tickerInput, range);
    },
    [loadQuote, tickerInput, range],
  );

  // Changing the range refetches the ticker already on screen.
  const handleRangeChange = useCallback(
    (next: Range) => {
      setRange(next);
      if (quote) void loadQuote(quote.ticker, next);
    },
    [quote, loadQuote],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const isIntraday = quote ? INTRADAY_RANGES.has(quote.range) : false;

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!quote?.history.length) return [];

    const candles = quote.history;
    const maSeries = showMA ? sma(candles, maPeriod) : null;
    const emaSeries = showEMA ? ema(candles, maPeriod) : null;
    const bands = showBollinger ? bollingerBands(candles, maPeriod) : null;

    const merged: ChartPoint[] = candles.map((candle, i) => ({
      ...candle,
      ma: maSeries?.[i],
      ema: emaSeries?.[i],
      upperBollinger: bands?.upper[i],
      lowerBollinger: bands?.lower[i],
      prevPrice: i > 0 ? candles[i - 1].price : undefined,
    }));

    return downsample(merged, MAX_CHART_POINTS);
  }, [quote, maPeriod, showMA, showEMA, showBollinger]);

  const saveChart = useCallback(async () => {
    const node = document.getElementById("chart-container");
    if (!node) return;
    // Loaded on demand — html2canvas is ~200 kB and most sessions never export.
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(node);
    const link = document.createElement("a");
    link.download = `${quote?.ticker ?? "chart"}-${range}.png`;
    link.href = canvas.toDataURL();
    link.click();
  }, [quote, range]);

  const axisTickFormatter = useCallback(
    (value: string) => formatTimestamp(value, isIntraday),
    [isIntraday],
  );

  // Memoized so the identity is stable across renders — otherwise every
  // consumer's useCallback/useMemo would invalidate on each render.
  const theme = useMemo(
    () =>
      darkMode
        ? { bg: "#0b0f14", panel: "#121820", text: "#e6edf3", muted: "#8b949e", grid: "#2f3740" }
        : { bg: "#ffffff", panel: "#f6f8fa", text: "#1f2328", muted: "#59636e", grid: "#d8dee4" },
    [darkMode],
  );

  const renderTooltip = useCallback(
    ({ active, payload, label }: TooltipContentProps<number, string>) => {
      if (!active || !payload?.length || label === undefined || label === null) return null;
      const point = payload[0].payload as ChartPoint | undefined;
      if (!point) return null;
      const change = point.prevPrice !== undefined ? point.price - point.prevPrice : undefined;

      return (
        <div
          style={{
            background: theme.panel,
            color: theme.text,
            border: `1px solid ${theme.grid}`,
            padding: "0.75rem",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>{formatTimestamp(String(label), isIntraday)}</strong>
          <div>Close: ${point.price.toFixed(2)}</div>
          <div>Open: ${point.open.toFixed(2)}</div>
          <div>High: ${point.high.toFixed(2)}</div>
          <div>Low: ${point.low.toFixed(2)}</div>
          <div>Volume: {point.volume.toLocaleString()}</div>
          {change !== undefined && (
            <div>
              Change: {change >= 0 ? "+" : ""}
              {change.toFixed(2)}
            </div>
          )}
          {point.ma !== undefined && <div>SMA({maPeriod}): ${point.ma.toFixed(2)}</div>}
          {point.ema !== undefined && <div>EMA({maPeriod}): ${point.ema.toFixed(2)}</div>}
          {point.upperBollinger !== undefined && (
            <div>
              Bollinger: ${point.lowerBollinger?.toFixed(2)} – ${point.upperBollinger.toFixed(2)}
            </div>
          )}
        </div>
      );
    },
    [theme, isIntraday, maPeriod],
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "2rem",
        padding: "2rem",
        minHeight: "100vh",
        background: theme.bg,
        color: theme.text,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <main style={{ flex: "3 1 640px", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Stock Predictor</h1>
          <button type="button" onClick={() => setDarkMode((value) => !value)}>
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </header>

        <p style={{ color: theme.muted, fontSize: 13, maxWidth: "60ch" }}>
          Educational tool. Everything shown describes past price behaviour — it is not a
          prediction and not investment advice.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor="ticker-input" style={{ position: "absolute", left: -9999 }}>
            Stock ticker symbol
          </label>
          <input
            id="ticker-input"
            type="text"
            placeholder="Enter a ticker (AAPL, MSFT, VOO)"
            value={tickerInput}
            onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: 8,
              border: `1px solid ${theme.grid}`,
              background: theme.panel,
              color: theme.text,
              minWidth: 240,
            }}
          />
          <button type="submit" disabled={loading || !tickerInput.trim()}>
            {loading ? "Loading…" : "Get data"}
          </button>
        </form>

        <div role="group" aria-label="Chart range" style={{ display: "flex", gap: 4, marginTop: 12 }}>
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => handleRangeChange(option)}
              style={{
                padding: "0.35rem 0.7rem",
                borderRadius: 6,
                cursor: "pointer",
                border: `1px solid ${range === option ? "#2f81f7" : theme.grid}`,
                background: range === option ? "#2f81f7" : "transparent",
                color: range === option ? "#fff" : theme.text,
                fontWeight: range === option ? 600 : 400,
              }}
            >
              {option}
            </button>
          ))}
        </div>

        <div aria-live="polite" aria-atomic="true">
          {error && (
            <p
              role="alert"
              style={{
                marginTop: "1rem",
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid #f85149",
                color: "#f85149",
                background: darkMode ? "#2d1214" : "#fff1f0",
              }}
            >
              {error}
            </p>
          )}

          {quote && !error && (
            <section
              style={{
                marginTop: "1rem",
                padding: "1rem",
                borderRadius: 10,
                border: `1px solid ${theme.grid}`,
                background: theme.panel,
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.25rem" }}>
                {quote.ticker} · {quote.company_name}
              </h2>
              <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginTop: 8 }}>
                <span>Close ${quote.price.toFixed(2)}</span>
                <span>Open ${quote.open.toFixed(2)}</span>
                <span>High ${quote.high.toFixed(2)}</span>
                <span>Low ${quote.low.toFixed(2)}</span>
                <span>Volume {quote.volume.toLocaleString()}</span>
                <strong style={{ color: quote.change_points >= 0 ? "#3fb950" : "#f85149" }}>
                  {/* Arrow carries the meaning too, so it is not colour-only. */}
                  {quote.change_points >= 0 ? "▲" : "▼"} {quote.change_points >= 0 ? "+" : ""}
                  {quote.change_points.toFixed(2)} ({quote.change_percent.toFixed(2)}%) over {quote.range}
                </strong>
              </div>
              <p style={{ margin: "0.5rem 0 0", fontSize: 12, color: theme.muted }}>
                As of {formatTimestamp(quote.as_of, isIntraday)} · source: {quote.source}
              </p>
            </section>
          )}
        </div>

        <fieldset
          style={{
            marginTop: 16,
            border: `1px solid ${theme.grid}`,
            borderRadius: 8,
            padding: "0.75rem 1rem",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <legend style={{ fontSize: 13, color: theme.muted }}>Indicators</legend>
          <label>
            <input type="checkbox" checked={showPrice} onChange={() => setShowPrice((v) => !v)} /> Price
          </label>
          <label>
            <input type="checkbox" checked={showMA} onChange={() => setShowMA((v) => !v)} /> SMA
          </label>
          <label>
            <input type="checkbox" checked={showEMA} onChange={() => setShowEMA((v) => !v)} /> EMA
          </label>
          <label>
            <input
              type="checkbox"
              checked={showBollinger}
              onChange={() => setShowBollinger((v) => !v)}
            />{" "}
            Bollinger
          </label>
          <label>
            <input type="checkbox" checked={showVolume} onChange={() => setShowVolume((v) => !v)} />{" "}
            Volume
          </label>
          <label>
            Period{" "}
            <input
              type="number"
              min={2}
              max={200}
              value={maPeriod}
              onChange={(event) =>
                setMAPeriod(Math.min(200, Math.max(2, Number(event.target.value) || 2)))
              }
              style={{ width: 64, marginLeft: 4 }}
            />
          </label>
          <button type="button" onClick={saveChart} disabled={!chartData.length}>
            Save PNG
          </button>
        </fieldset>

        {chartData.length > 0 && (
          <div
            id="chart-container"
            role="img"
            aria-label={`Price chart for ${quote?.ticker} over ${range}, ${chartData.length} data points, ranging from $${Math.min(...chartData.map((p) => p.low)).toFixed(2)} to $${Math.max(...chartData.map((p) => p.high)).toFixed(2)}`}
            style={{ marginTop: 16, height: 480 }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 16, right: 32, left: 0, bottom: 16 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="4 4" />
                <XAxis
                  dataKey="date"
                  tickFormatter={axisTickFormatter}
                  minTickGap={40}
                  stroke={theme.muted}
                />
                <YAxis yAxisId="price" domain={["auto", "auto"]} stroke={theme.muted} width={64} />
                <YAxis yAxisId="volume" orientation="right" stroke={theme.muted} width={64} />
                <Tooltip content={renderTooltip} />

                {showVolume && (
                  <Area
                    yAxisId="volume"
                    type="monotone"
                    dataKey="volume"
                    stroke="#8b949e"
                    fill="#8b949e"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                )}
                {showPrice && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="price"
                    stroke="#2f81f7"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {showMA && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ma"
                    stroke="#d29922"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {showEMA && (
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="ema"
                    stroke="#db61a2"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                )}
                {showBollinger && (
                  <>
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="upperBollinger"
                      stroke="#3fb950"
                      strokeWidth={1}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="lowerBollinger"
                      stroke="#3fb950"
                      strokeWidth={1}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </>
                )}
                <Brush dataKey="date" height={28} stroke="#2f81f7" tickFormatter={axisTickFormatter} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </main>

      <aside style={{ flex: "1 1 260px", minWidth: 240 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Recent searches</h2>
          <button type="button" onClick={clearHistory} disabled={!history.length}>
            Clear
          </button>
        </div>

        {history.length === 0 ? (
          <p style={{ color: theme.muted, fontSize: 14 }}>Nothing yet — look up a ticker above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
            {history.map((item) => (
              <li key={item.ticker} style={{ marginBottom: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => void loadQuote(item.ticker, range)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "0.75rem",
                    borderRadius: 8,
                    border: `1px solid ${theme.grid}`,
                    background: theme.panel,
                    color: theme.text,
                    cursor: "pointer",
                  }}
                >
                  <strong>{item.ticker}</strong>
                  <div style={{ fontSize: 12, color: theme.muted }}>{item.company_name}</div>
                  <div style={{ marginTop: 4 }}>
                    ${item.price.toFixed(2)}{" "}
                    <span style={{ color: item.change_points >= 0 ? "#3fb950" : "#f85149" }}>
                      {item.change_points >= 0 ? "▲" : "▼"} {item.change_percent.toFixed(2)}%
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

export default App;
