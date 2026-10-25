/**
 * Recurring items and recurring-pattern evidence. Pure, deterministic, local.
 *
 * - Occurrences are anchored on `next_date` and computed from the anchor, never
 *   step by step, so month-end clamping does not drift: monthly from Jan 31 is
 *   Feb 28 (Feb 29 in a leap year), then Mar 31. Quarterly is +3 months, yearly
 *   +12 months (Feb 29 -> Feb 28 in other years). Weekly is +7 days, biweekly
 *   +14 days. `end_date` is inclusive. Dates before `next_date` are not produced:
 *   the item says that is the next time it is due.
 * - Subscription detection only proposes candidates with their evidence. It never
 *   creates a recurring item; the user decides.
 * - Unusual category changes compare the last complete month with the average of
 *   up to 3 earlier complete months; months before tracking began are left out,
 *   never counted as zero.
 */

import { completeMonths, type MonthFlows } from "./ledger";
import { newId, type MoneyState, type Transaction } from "./model";
import type { Cadence, RecurringItem } from "./planning";

// --- calendar helpers ---------------------------------------------------------------

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/** Same day of month `months` later, clamped to that month's last day. */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, last));
}

const MONTH_STEP: Partial<Record<Cadence, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};
const DAY_STEP: Partial<Record<Cadence, number>> = { weekly: 7, biweekly: 14 };

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/** The k-th occurrence (k = 0 is `anchor`). */
export function nthOccurrence(
  anchor: string,
  cadence: Cadence,
  k: number,
): string {
  const months = MONTH_STEP[cadence];
  if (months !== undefined) return addMonthsClamped(anchor, months * k);
  return addDays(anchor, (DAY_STEP[cadence] ?? 7) * k);
}

const MAX_OCCURRENCES = 10_000;

/** Due dates of `item` within [from, to] inclusive, honouring `end_date`. */
export function occurrences(
  item: Pick<RecurringItem, "next_date" | "cadence" | "end_date">,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  const stop =
    item.end_date !== null && item.end_date < to ? item.end_date : to;
  for (let k = 0; k < MAX_OCCURRENCES; k++) {
    const date = nthOccurrence(item.next_date, item.cadence, k);
    if (date > stop) break;
    if (date >= from) out.push(date);
  }
  return out;
}

export interface Upcoming {
  date: string;
  item: RecurringItem;
}

/** Everything due from `asOf` through `asOf + days`, inclusive, by date. */
export function upcoming(
  items: RecurringItem[],
  asOf: string,
  days: number,
): Upcoming[] {
  const to = addDays(asOf, days);
  const out: Upcoming[] = [];
  for (const item of items) {
    for (const date of occurrences(item, asOf, to)) out.push({ date, item });
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.item.description.localeCompare(b.item.description),
  );
}

// --- subscription candidates ---------------------------------------------------------

/** Amounts within this fraction of the group's median amount count as "the same". */
export const AMOUNT_TOLERANCE = 0.05;
export const MIN_OCCURRENCES = 3;

/** Median gap between payments that identifies each cadence, in days, inclusive. */
export const CADENCE_BANDS: { cadence: Cadence; min: number; max: number }[] = [
  { cadence: "weekly", min: 6, max: 8 },
  { cadence: "biweekly", min: 13, max: 15 },
  { cadence: "monthly", min: 28, max: 31 },
  { cadence: "quarterly", min: 89, max: 92 },
  { cadence: "yearly", min: 360, max: 370 },
];

/** Slack, in days, for an individual gap around its cadence band. */
export const GAP_SLACK_DAYS = 3;

export interface CandidateEvidence {
  date: string;
  amount_cents: number;
}

export interface SubscriptionCandidate {
  key: string;
  description: string;
  account_id: string;
  category: string;
  cadence: Cadence;
  evidence: CandidateEvidence[];
  intervals_days: number[];
  median_interval_days: number;
  typical_amount_cents: number; // median of the matching payments
  min_amount_cents: number;
  max_amount_cents: number;
  /** Gaps outside the cadence band (with slack). */
  irregular_gaps: number;
  confidence: "high" | "medium" | "low";
  basis: string;
  /** Last payment + one cadence step; a suggestion the user can change. */
  suggested_next_date: string;
}

export function normalizeDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z&]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Settled expenses grouped by normalized description + account. A group is a
 * candidate when at least 3 payments have amounts within 5% of their median and
 * the median gap between them falls in a cadence band (weekly 6-8 days, biweekly
 * 13-15, monthly 28-31, quarterly 89-92, yearly 360-370). Each gap may be off
 * its band by 3 days; more than a quarter of gaps outside that rejects the group
 * as irregular. Groups already tracked as a recurring item on the same account
 * are skipped. Returns candidates only; nothing is created.
 */
export function detectSubscriptionCandidates(
  transactions: Transaction[],
  existing: RecurringItem[] = [],
): SubscriptionCandidate[] {
  const tracked = new Set(
    existing.map(
      (r) => `${r.account_id}|${normalizeDescription(r.description)}`,
    ),
  );
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.kind !== "expense" || tx.status !== "settled") continue;
    const name = normalizeDescription(tx.description);
    if (!name) continue;
    const key = `${tx.account_id}|${name}`;
    if (tracked.has(key)) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const out: SubscriptionCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < MIN_OCCURRENCES) continue;
    const mid = median(list.map((t) => t.amount_cents));
    const same = list
      .filter((t) => Math.abs(t.amount_cents - mid) <= AMOUNT_TOLERANCE * mid)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (same.length < MIN_OCCURRENCES) continue;
    const intervals = same
      .slice(1)
      .map((t, i) => daysBetween(same[i].date, t.date));
    if (intervals.some((d) => d <= 0)) continue; // same-day repeats are not a cadence
    const medianGap = median(intervals);
    const band = CADENCE_BANDS.find(
      (b) => medianGap >= b.min && medianGap <= b.max,
    );
    if (!band) continue;
    const irregular = intervals.filter(
      (d) => d < band.min - GAP_SLACK_DAYS || d > band.max + GAP_SLACK_DAYS,
    ).length;
    if (irregular / intervals.length > 0.25) continue;
    const amounts = same.map((t) => t.amount_cents);
    const identical = amounts.every((a) => a === amounts[0]);
    const confidence: SubscriptionCandidate["confidence"] =
      irregular > 0 ? "low" : same.length >= 4 && identical ? "high" : "medium";
    const latest = same[same.length - 1];
    out.push({
      key,
      description: latest.description,
      account_id: latest.account_id,
      category: latest.category,
      cadence: band.cadence,
      evidence: same.map((t) => ({
        date: t.date,
        amount_cents: t.amount_cents,
      })),
      intervals_days: intervals,
      median_interval_days: medianGap,
      typical_amount_cents: median(amounts),
      min_amount_cents: Math.min(...amounts),
      max_amount_cents: Math.max(...amounts),
      irregular_gaps: irregular,
      confidence,
      basis: `${same.length} settled payments within 5% of the median amount; median gap ${medianGap} days${irregular ? `; ${irregular} gap${irregular === 1 ? "" : "s"} outside the usual range` : ""}.`,
      suggested_next_date: nthOccurrence(latest.date, band.cadence, 1),
    });
  }
  return out.sort(
    (a, b) =>
      b.evidence.length - a.evidence.length ||
      a.description.localeCompare(b.description),
  );
}

/** The recurring item a candidate would become. Called only when the user asks. */
export function candidateToRecurring(c: SubscriptionCandidate): RecurringItem {
  return {
    id: newId(),
    description: c.description,
    kind: "expense",
    amount_cents: c.typical_amount_cents,
    account_id: c.account_id,
    to_account_id: null,
    category: c.category || "Uncategorized",
    cadence: c.cadence,
    next_date: c.suggested_next_date,
    end_date: null,
    certainty:
      c.min_amount_cents === c.max_amount_cents ? "fixed" : "estimated",
    essential: false,
  };
}

// --- unusual category changes --------------------------------------------------------

export const UNUSUAL_MIN_RATIO = 0.5; // at least 50% above the baseline average
export const UNUSUAL_MIN_CENTS = 5_000; // and at least $50 above it
export const BASELINE_MONTHS = 3;
export const MIN_BASELINE_MONTHS = 2;

export interface UnusualChange {
  category: string;
  last_month_cents: number;
  baseline_average_cents: number;
  increase_cents: number;
  /** Increase / baseline; null when the baseline is zero (new spending). */
  increase_ratio: number | null;
}

export interface UnusualReport {
  month: string; // the last complete month
  baseline_months: string[];
  /** Earlier months left out because tracking had not started (not zeros). */
  excluded_pre_tracking: string[];
  /** Earlier tracked months left out because they have no recorded spending. */
  excluded_no_spending: string[];
  changes: UnusualChange[];
  /** Why no comparison was made; null when it was. */
  unavailable_reason: string | null;
}

/** Earliest account opening date: before it, nothing was being recorded. */
export function trackingSince(state: MoneyState): string | null {
  return state.accounts.reduce<string | null>(
    (min, a) => (min === null || a.opening_date < min ? a.opening_date : min),
    null,
  );
}

/**
 * Spending by category in the last complete month before `asOf`, against the
 * average of the 3 complete months before it. Baseline months that end before
 * tracking began, or that have no recorded spending at all, are excluded rather
 * than counted as zero; at least 2 baseline months are required. A category is
 * flagged when it is at least 50% and at least $50 above its baseline average.
 */
export function unusualCategoryChanges(
  state: MoneyState,
  asOf: string,
): UnusualReport {
  const since = trackingSince(state);
  const [last, ...rest] = completeMonths(
    state,
    asOf,
    BASELINE_MONTHS + 1,
  ).reverse();
  const report: UnusualReport = {
    month: last.month,
    baseline_months: [],
    excluded_pre_tracking: [],
    excluded_no_spending: [],
    changes: [],
    unavailable_reason: null,
  };
  if (since === null || last.end < since) {
    report.unavailable_reason = `Tracking had not started by ${last.month}.`;
    return report;
  }
  const baseline: MonthFlows[] = [];
  for (const m of rest.reverse()) {
    if (m.end < since) report.excluded_pre_tracking.push(m.month);
    else if (m.spending <= 0) report.excluded_no_spending.push(m.month);
    else baseline.push(m);
  }
  report.baseline_months = baseline.map((m) => m.month);
  if (baseline.length < MIN_BASELINE_MONTHS) {
    report.unavailable_reason = `Needs at least ${MIN_BASELINE_MONTHS} earlier complete months with recorded spending; found ${baseline.length}.`;
    return report;
  }
  const categories = new Set([
    ...Object.keys(last.by_category),
    ...baseline.flatMap((m) => Object.keys(m.by_category)),
  ]);
  for (const category of categories) {
    const now = last.by_category[category] ?? 0;
    const avg = Math.round(
      baseline.reduce((s, m) => s + (m.by_category[category] ?? 0), 0) /
        baseline.length,
    );
    const increase = now - avg;
    const ratio = avg > 0 ? increase / avg : null;
    const bigEnough = increase >= UNUSUAL_MIN_CENTS;
    const relative = avg > 0 ? increase >= UNUSUAL_MIN_RATIO * avg : true;
    if (bigEnough && relative) {
      report.changes.push({
        category,
        last_month_cents: now,
        baseline_average_cents: avg,
        increase_cents: increase,
        increase_ratio: ratio,
      });
    }
  }
  report.changes.sort((a, b) => b.increase_cents - a.increase_cents);
  return report;
}
