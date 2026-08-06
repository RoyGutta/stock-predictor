/**
 * Display formatting.
 *
 * Centralised so a price is written the same way everywhere. Every formatter
 * returns an em dash for missing data rather than "0" or "N/A" — a statistic
 * that could not be computed must never read as a real value of zero.
 */

export const EMPTY = "—";

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatPrice(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Signed, so a gain is unambiguous without relying on color. */
export function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

/** `value` is a fraction (0.0432 → "+4.32%"). */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(digits)}%`;
}

/** Already-percentage values that carry no direction, such as volatility. */
export function formatPercentPlain(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return value.toFixed(digits);
}

export function formatVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  return value >= 100_000 ? compactNumber.format(value) : wholeNumber.format(value);
}

/**
 * Format an ISO timestamp for display.
 * Intraday bars keep their time; daily bars would otherwise all read midnight.
 */
export function formatTimestamp(iso: string, intraday: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return intraday
    ? date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Shorter form for chart axes, where space is tight. */
export function formatAxisTick(iso: string, intraday: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return intraday
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
