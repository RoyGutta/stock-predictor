/**
 * CSV export.
 *
 * Hand-rolled rather than pulled from a package: the whole job is quoting and
 * a Blob download, and a dependency for that is not worth the supply-chain
 * surface. PNG export previously used html2canvas, which is unmaintained and
 * cannot render the CSS custom properties and color-mix() this UI is built on.
 */

import type { Candle, IndicatorSeries } from "../types/market";

/** Escape one CSV field: quote it when it holds a comma, quote, or newline. */
function escapeField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\r\n");
}

/**
 * Build a CSV of price history with any indicator values aligned to it.
 * Undefined indicator values are left blank rather than written as 0.
 */
export function buildHistoryCsv(
  candles: readonly Candle[],
  series: IndicatorSeries | null,
): string {
  const header = ["date", "open", "high", "low", "close", "volume"];
  if (series) {
    header.push(`sma_${series.period}`, `ema_${series.period}`, "bollinger_upper", "bollinger_lower", "rsi_14");
  }

  const rows: (string | number | null)[][] = [header];
  candles.forEach((candle, i) => {
    const row: (string | number | null)[] = [
      candle.date,
      candle.open,
      candle.high,
      candle.low,
      candle.price,
      candle.volume,
    ];
    if (series) {
      row.push(
        series.sma[i] ?? null,
        series.ema[i] ?? null,
        series.bollinger_upper[i] ?? null,
        series.bollinger_lower[i] ?? null,
        series.rsi[i] ?? null,
      );
    }
    rows.push(row);
  });

  return toCsv(rows);
}

/** Trigger a client-side file download. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel open UTF-8 correctly; without it, accented names mojibake.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
