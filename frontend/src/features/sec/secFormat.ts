/**
 * Formatting for reported financial figures.
 *
 * Absent values render as an em dash, never 0. Large currency amounts are
 * scaled (B, M) because reported figures run to twelve digits; per-share and
 * ratio units keep their own form.
 */

import { EMPTY } from "../../lib/format";
import type { DerivedPoint, FactPoint } from "../../types/sec";

export function formatReported(
  value: number | null | undefined,
  unit: string,
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (unit === "USD/shares") return `${sign}$${abs.toFixed(2)}`;
  const scales: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [scale, suffix] of scales) {
    if (abs >= scale) return `${sign}$${(abs / scale).toFixed(2)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

/** "+12.3%" / "−4.0%"; absent change renders as an em dash. */
export function formatChangePct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY;
  const pct = Math.abs(value * 100).toFixed(1);
  return value > 0 ? `+${pct}%` : value < 0 ? `−${pct}%` : "0.0%";
}

/** Change in percentage points, for ratios (a margin from 40% to 42% is +2.0 pts). */
export function formatPointChange(value: number): string {
  const pts = Math.abs(value * 100).toFixed(1);
  return value > 0 ? `+${pts} pts` : value < 0 ? `−${pts} pts` : "0.0 pts";
}

/** "2026-10-18 16:52 UTC" from an ISO timestamp. */
export function formatRetrieved(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** SEC records fiscal year end as MMDD. */
export function formatFiscalYearEnd(mmdd: string | null): string | null {
  if (!mmdd || !/^\d{4}$/.test(mmdd)) return null;
  const month = MONTHS[Number(mmdd.slice(0, 2)) - 1];
  return month ? `${month} ${Number(mmdd.slice(2))}` : null;
}

/** The period a figure covers, in words. */
export function describePeriod(
  start: string | null,
  end: string,
  days: number | null,
): string {
  if (start == null || days == null) return `Balance at ${end}`;
  const span = days >= 350 ? "Year" : days <= 100 ? "Quarter" : `${days} days`;
  return `${span} ${start} to ${end}`;
}

/** Year-over-year change in words: percent for amounts, points for ratios. */
export function yoyText(
  point: FactPoint | DerivedPoint,
  unit: string,
): string | null {
  if (!point.yoy) return null;
  if (unit === "ratio")
    return `${formatPointChange(point.yoy.change)} vs a year earlier`;
  if (point.yoy.change_pct == null) {
    const sign = point.yoy.change > 0 ? "+" : "";
    return `${sign}${formatReported(point.yoy.change, unit)} vs a year earlier`;
  }
  return `${formatChangePct(point.yoy.change_pct)} vs a year earlier`;
}
