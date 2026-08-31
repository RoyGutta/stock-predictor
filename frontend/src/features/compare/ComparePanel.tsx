import { useId, useState } from "react";

import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { CorrelationPanel } from "../simulation/CorrelationPanel";
import { useCompare, useCorrelation } from "../../hooks/useMarketData";
import { formatPercentPlain, formatPrice, formatRatio } from "../../lib/format";
import type { CompareRow, Range } from "../../types/market";
import "./compare.css";

/**
 * Side-by-side comparison of up to six securities.
 *
 * Securities are columns and measurements are rows, so scanning across a row
 * compares like with like. There is no ranking, no highlight on a "winner",
 * and no sorting by desirability -- the API note and disclaimer travel with
 * the data and are rendered verbatim.
 */

const MAX_TICKERS = 6;
const WINDOWS: Range[] = ["1Y", "5Y"];

function parseTickers(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    const symbol = part.trim().toUpperCase();
    if (symbol) seen.add(symbol);
  }
  return [...seen].slice(0, MAX_TICKERS);
}

interface MetricRow {
  label: string;
  render: (row: CompareRow) => string;
}

const METRICS: MetricRow[] = [
  { label: "Price", render: (row) => formatPrice(row.price) },
  {
    label: "Change over window",
    render: (row) =>
      row.change_percent == null ? "—" : formatPercentPlain(row.change_percent / 100),
  },
  { label: "Annualized return", render: (row) => formatPercentPlain(row.annualized_return) },
  { label: "Volatility", render: (row) => formatPercentPlain(row.annualized_volatility) },
  { label: "Sharpe", render: (row) => formatRatio(row.sharpe_ratio) },
  { label: "Sortino", render: (row) => formatRatio(row.sortino_ratio) },
  { label: "Max drawdown", render: (row) => formatPercentPlain(row.max_drawdown) },
  {
    label: "Momentum",
    render: (row) =>
      row.momentum_state == null || row.momentum_state === "insufficient"
        ? "—"
        : `${row.momentum_score}/${row.momentum_total} (${row.momentum_state})`,
  },
  { label: "Bars measured", render: (row) => String(row.bars) },
];

export function ComparePanel() {
  const [draft, setDraft] = useState("VOO, QQQ, AAPL");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [window, setWindow] = useState<Range>("1Y");
  const inputId = useId();

  const compare = useCompare(submitted, window);
  const correlation = useCorrelation(submitted, window, submitted.length >= 2);

  const parsed = parseTickers(draft);
  const canRun = parsed.length >= 2;

  return (
    <Card
      title="Compare securities"
      action={<span className="eyebrow">Same window, same method</span>}
    >
      <p className="cmp-intro">
        Measure two to six securities over the identical window and see their historical
        characteristics side by side. The numbers describe how each behaved — they do not
        say which one to pick.
      </p>

      <form
        className="cmp-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRun) setSubmitted(parsed);
        }}
      >
        <label className="cmp-field" htmlFor={inputId}>
          <span className="cmp-label">Tickers (2–6, comma separated)</span>
          <input
            id={inputId}
            type="text"
            value={draft}
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="VOO, QQQ, AAPL"
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
          />
        </label>
        <label className="cmp-field cmp-field--window">
          <span className="cmp-label">Window</span>
          <select value={window} onChange={(event) => setWindow(event.target.value as Range)}>
            {WINDOWS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" type="submit" disabled={!canRun || compare.loading}>
          {compare.loading ? "Comparing…" : "Compare"}
        </Button>
      </form>

      {!canRun && (
        <p className="cmp-hint" role="status">
          Enter at least two ticker symbols to compare.
        </p>
      )}

      {compare.error && (
        <Callout tone="note" role="alert">
          {compare.error}
        </Callout>
      )}

      {compare.loading && (
        <div className="cmp-loading">
          <Skeleton height={200} />
        </div>
      )}

      {compare.data && !compare.loading && !compare.error && (
        <div className="cmp-results">
          {Object.keys(compare.data.unavailable).length > 0 && (
            <Callout tone="note">
              Not shown:{" "}
              {Object.entries(compare.data.unavailable)
                .map(([symbol, reason]) => `${symbol} (${reason})`)
                .join("; ")}
            </Callout>
          )}

          <div className="cmp-scroll">
            <table className="cmp-table">
              <caption className="visually-hidden">
                Historical characteristics of the selected securities over {window}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Historical measure</th>
                  {compare.data.rows.map((row) => (
                    <th scope="col" key={row.ticker}>
                      <span className="cmp-ticker">{row.ticker}</span>
                      {row.company_name && (
                        <span className="cmp-company">{row.company_name}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map((metric) => (
                  <tr key={metric.label}>
                    <th scope="row">{metric.label}</th>
                    {compare.data?.rows.map((row) => (
                      <td key={row.ticker} className="numeric">
                        {metric.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="cmp-note">{compare.data.note}</p>

          <CorrelationPanel
            data={correlation.data}
            loading={correlation.loading}
            error={correlation.error}
          />

          <Callout tone="accent">
            <p className="cmp-note">{compare.data.disclaimer}</p>
          </Callout>
        </div>
      )}
    </Card>
  );
}
