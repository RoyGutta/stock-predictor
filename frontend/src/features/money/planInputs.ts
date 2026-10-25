/**
 * Shared, pure inputs for the debt plan and scenario tools: tracked complete
 * months, essential spending, recurring-item expansion, and date arithmetic.
 * Computed only from the user's own records; missing inputs are null, never 0.
 */

import { completeMonths, type MonthFlows } from "./ledger";
import { ACCOUNT_TYPES, type Account, type MoneyState } from "./model";
import type { Cadence, RecurringItem } from "./planning";

// --- dates ---------------------------------------------------------------------

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

/** Add calendar months, clamping the day to the target month's length (Jan 31 + 1 = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return fmt(ty, tm, Math.min(d, last));
}

/** Whole calendar months from `from` to `to` (partial months round up), minimum 1. */
export function monthsUntil(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const whole = (ty - fy) * 12 + (tm - fm) + (td > fd ? 1 : 0);
  return Math.max(1, whole);
}

const STEP: Record<Cadence, { days?: number; months?: number }> = {
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
};

function occurrence(base: string, cadence: Cadence, k: number): string {
  const step = STEP[cadence];
  return step.days != null
    ? addDays(base, step.days * k)
    : addMonths(base, (step.months ?? 1) * k);
}

export interface Occurrence {
  item: RecurringItem;
  date: string;
}

/**
 * Dates each recurring item falls on within [start, end] inclusive. Each date is
 * computed from `next_date` (not from the previous occurrence), so month-end
 * clamping does not drift. Items past their `end_date` stop.
 */
export function expandRecurring(
  items: RecurringItem[],
  start: string,
  end: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const item of items) {
    for (let k = 0; k < 2000; k++) {
      const date = occurrence(item.next_date, item.cadence, k);
      if (date > end) break;
      if (item.end_date != null && date > item.end_date) break;
      if (date >= start) out.push({ item, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// --- accounts ------------------------------------------------------------------

export function isLiquid(account: Account | undefined): boolean {
  return (
    account != null &&
    !account.archived &&
    account.currency === "USD" &&
    ACCOUNT_TYPES[account.type].liquid
  );
}

/**
 * How one recurring occurrence changes liquid funds: income into a liquid
 * account adds, an expense from one subtracts (a card charge does not touch
 * liquid funds until the card is paid), and a transfer counts only when it
 * crosses between liquid and non-liquid accounts.
 */
export function liquidEffect(
  item: RecurringItem,
  accounts: Map<string, Account>,
): number {
  const from = accounts.get(item.account_id);
  const fromLiquid = isLiquid(from);
  switch (item.kind) {
    case "income":
      return fromLiquid ? item.amount_cents : 0;
    case "expense":
      return fromLiquid ? -item.amount_cents : 0;
    case "transfer": {
      const toLiquid = isLiquid(
        item.to_account_id ? accounts.get(item.to_account_id) : undefined,
      );
      if (fromLiquid === toLiquid) return 0;
      return fromLiquid ? -item.amount_cents : item.amount_cents;
    }
  }
}

/** Recurring money leaving liquid funds in [start, end]: expenses and payments out, income ignored. */
export function obligationsWithin(
  state: MoneyState,
  start: string,
  end: string,
): number {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  return expandRecurring(state.planning.recurring, start, end).reduce(
    (sum, o) => {
      const effect = liquidEffect(o.item, byId);
      return effect < 0 ? sum - effect : sum;
    },
    0,
  );
}

// --- history -------------------------------------------------------------------

/** The earliest account opening date: nothing was tracked before it. */
export function trackingSince(state: MoneyState): string | null {
  if (state.accounts.length === 0) return null;
  return state.accounts.reduce(
    (min, a) => (a.opening_date < min ? a.opening_date : min),
    "9999-12-31",
  );
}

/**
 * Up to `count` complete months before `asOf`, excluding months that ended
 * before tracking began (those would read as $0 of activity, which is missing
 * data rather than zero).
 */
export function trackedMonths(
  state: MoneyState,
  asOf: string,
  count = 3,
): MonthFlows[] {
  const since = trackingSince(state);
  if (since == null) return [];
  return completeMonths(state, asOf, count).filter((m) => m.end >= since);
}

export interface Averages {
  months_used: number;
  income_cents: number | null;
  spending_cents: number | null;
  surplus_cents: number | null;
  essential_cents: number | null;
}

/** Monthly averages over tracked complete months, rounded to the cent. Null without any. */
export function monthlyAverages(
  state: MoneyState,
  asOf: string,
  count = 3,
): Averages {
  const months = trackedMonths(state, asOf, count);
  if (months.length === 0) {
    return {
      months_used: 0,
      income_cents: null,
      spending_cents: null,
      surplus_cents: null,
      essential_cents: null,
    };
  }
  const essential = new Set(state.planning.essential_categories);
  const avg = (pick: (m: MonthFlows) => number) =>
    Math.round(months.reduce((s, m) => s + pick(m), 0) / months.length);
  const income = avg((m) => m.income);
  const spending = avg((m) => m.spending);
  return {
    months_used: months.length,
    income_cents: income,
    spending_cents: spending,
    surplus_cents: income - spending,
    essential_cents: avg((m) =>
      Object.entries(m.by_category).reduce(
        (s, [category, cents]) => (essential.has(category) ? s + cents : s),
        0,
      ),
    ),
  };
}
