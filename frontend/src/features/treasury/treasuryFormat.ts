/** Formatting for Treasury rates. Missing renders as an em dash, never 0. */

import { EMPTY, parseIsoDate } from "../../lib/format";

export function formatYield(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? EMPTY
    : `${value.toFixed(2)}%`;
}

/** Percentage points with basis points: "0.31 pts (31 bp)". */
export function formatSpread(
  pp: number | null | undefined,
  bp: number | null | undefined,
): string {
  if (pp == null || bp == null || !Number.isFinite(pp)) return EMPTY;
  const sign = pp < 0 ? "−" : "";
  return `${sign}${Math.abs(pp).toFixed(2)} pts (${sign}${Math.abs(bp)} bp)`;
}

/** Signed basis-point change: "+5 bp", "−14 bp", "0 bp". */
export function formatBpChange(bp: number | null | undefined): string {
  if (bp == null || !Number.isFinite(bp)) return EMPTY;
  if (bp > 0) return `+${bp} bp`;
  if (bp < 0) return `−${Math.abs(bp)} bp`;
  return "0 bp";
}

/** "Fri, Oct 23, 2026" for a date-only ISO string, read as a calendar day. */
export function formatObservationDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function shapeText(shape: string | null, threshold: number): string {
  if (shape === "inverted") {
    return "Inverted: the 10-year yield is below the 3-month yield.";
  }
  if (shape === "flat") {
    return `Comparatively flat: the 10-year yield is above the 3-month yield by less than ${threshold.toFixed(2)} percentage points.`;
  }
  if (shape === "upward") {
    return `Upward sloping: the 10-year yield is at least ${threshold.toFixed(2)} percentage points above the 3-month yield.`;
  }
  return "The curve's shape cannot be stated because the 10-year or 3-month yield is missing.";
}
