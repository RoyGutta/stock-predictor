/**
 * Monthly budgets: actual spending against each limit, with two clearly labeled
 * month-end projections. Pure, deterministic, local.
 *
 * - Actual = settled spending in the category from the 1st of the month through
 *   `asOf` (or month end, if earlier), from ledger.flows: expenses + interest -
 *   refunds. Pending transactions are not counted.
 * - Projection A, run rate: actual / days elapsed x days in month. Days elapsed
 *   counts `asOf` itself. Null before the month starts.
 * - Projection B, scheduled: actual + recurring expenses in the category due
 *   after `asOf` and by month end. Items marked "estimated" are included and
 *   counted, because their amounts vary.
 *   Neither is a forecast: A assumes the pace so far continues, B assumes only
 *   the recorded recurring items happen.
 * - Status: "over" when actual > limit; "near" when actual >= 85% of the limit;
 *   otherwise "under".
 * - Fixed vs variable: a category is "fixed" when it is marked essential or has
 *   a recurring expense item with certainty "fixed"; every other category is
 *   "variable". This is a definition, not a judgment about the spending.
 */

import { flows, monthBounds } from "./ledger";
import type { MoneyState } from "./model";
import type { Budget, PlanningState } from "./planning";
import { addDays, occurrences } from "./recurring";

export const NEAR_THRESHOLD = 0.85;

export type BudgetStatus = "under" | "near" | "over";

export interface Projection {
  cents: number | null;
  reason: string | null; // why it is null
}

export interface BudgetRow {
  budget: Budget;
  category: string;
  limit_cents: number;
  actual_cents: number;
  remaining_cents: number; // limit - actual; negative when over
  percent_used: number; // actual / limit, a fraction
  status: BudgetStatus;
  run_rate: Projection;
  scheduled: Projection;
  /** Recurring expenses still due this month in the category. */
  scheduled_remaining_cents: number;
  scheduled_count: number;
  scheduled_estimated_count: number;
}

export interface MonthPeriod {
  month: string;
  start: string;
  end: string;
  /** Last date counted in actuals: min(asOf, month end); null before the month starts. */
  through: string | null;
  days_in_month: number;
  days_elapsed: number;
}

export interface BudgetReport {
  period: MonthPeriod;
  rows: BudgetRow[];
  total_limit_cents: number;
  total_actual_budgeted_cents: number;
  unbudgeted: { category: string; cents: number }[];
  unbudgeted_total_cents: number;
  income_cents: number;
  spending_cents: number;
  net_cents: number;
  fixed_cents: number;
  variable_cents: number;
  fixed_categories: string[];
}

export const FIXED_DEFINITION =
  "Fixed = spending in categories marked essential or that have a recurring expense with a fixed amount. Variable = all other spending.";

export function budgetStatus(actual: number, limit: number): BudgetStatus {
  if (actual > limit) return "over";
  if (actual >= NEAR_THRESHOLD * limit) return "near";
  return "under";
}

export function monthPeriod(month: string, asOf: string): MonthPeriod {
  const { start, end } = monthBounds(month);
  const days = Number(end.slice(8, 10));
  if (asOf < start) {
    return {
      month,
      start,
      end,
      through: null,
      days_in_month: days,
      days_elapsed: 0,
    };
  }
  const through = asOf < end ? asOf : end;
  return {
    month,
    start,
    end,
    through,
    days_in_month: days,
    days_elapsed: Number(through.slice(8, 10)),
  };
}

/** actual / days elapsed x days in month, rounded to the cent. */
export function runRateProjection(
  actual: number,
  period: MonthPeriod,
): Projection {
  if (period.days_elapsed === 0) {
    return { cents: null, reason: "The month has not started yet." };
  }
  return {
    cents: Math.round((actual / period.days_elapsed) * period.days_in_month),
    reason: null,
  };
}

/** The budget that applies in `month`: latest start_month on or before it. */
export function activeBudgets(budgets: Budget[], month: string): Budget[] {
  const byCategory = new Map<string, Budget>();
  for (const b of budgets) {
    if (b.start_month > month) continue;
    const current = byCategory.get(b.category);
    if (!current || b.start_month > current.start_month)
      byCategory.set(b.category, b);
  }
  return [...byCategory.values()].sort((a, b) =>
    a.category.localeCompare(b.category),
  );
}

export function fixedCategories(planning: PlanningState): Set<string> {
  const out = new Set(planning.essential_categories);
  for (const r of planning.recurring) {
    if (r.kind === "expense" && r.certainty === "fixed") out.add(r.category);
  }
  return out;
}

export function budgetReport(
  state: MoneyState,
  planning: PlanningState,
  month: string,
  asOf: string,
): BudgetReport {
  const period = monthPeriod(month, asOf);
  const f = period.through
    ? flows(state, period.start, period.through)
    : flows(state, period.start, addDays(period.start, -1)); // empty window

  // Recurring expenses still due after asOf and by month end, by category.
  const from = period.through ? addDays(period.through, 1) : period.start;
  const scheduled = new Map<
    string,
    { cents: number; n: number; est: number }
  >();
  if (from <= period.end) {
    for (const item of planning.recurring) {
      if (item.kind !== "expense") continue;
      const n = occurrences(item, from, period.end).length;
      if (n === 0) continue;
      const s = scheduled.get(item.category) ?? { cents: 0, n: 0, est: 0 };
      s.cents += n * item.amount_cents;
      s.n += n;
      if (item.certainty === "estimated") s.est += n;
      scheduled.set(item.category, s);
    }
  }

  const rows: BudgetRow[] = activeBudgets(planning.budgets, month).map(
    (budget) => {
      const actual = f.by_category[budget.category] ?? 0;
      const s = scheduled.get(budget.category) ?? { cents: 0, n: 0, est: 0 };
      return {
        budget,
        category: budget.category,
        limit_cents: budget.limit_cents,
        actual_cents: actual,
        remaining_cents: budget.limit_cents - actual,
        percent_used: actual / budget.limit_cents,
        status: budgetStatus(actual, budget.limit_cents),
        run_rate: runRateProjection(actual, period),
        scheduled: { cents: actual + s.cents, reason: null },
        scheduled_remaining_cents: s.cents,
        scheduled_count: s.n,
        scheduled_estimated_count: s.est,
      };
    },
  );

  const budgeted = new Set(rows.map((r) => r.category));
  const unbudgeted = Object.entries(f.by_category)
    .filter(([c, v]) => !budgeted.has(c) && v !== 0)
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);
  const fixedSet = fixedCategories(planning);
  let fixed = 0;
  let variable = 0;
  for (const [category, cents] of Object.entries(f.by_category)) {
    if (fixedSet.has(category)) fixed += cents;
    else variable += cents;
  }

  return {
    period,
    rows,
    total_limit_cents: rows.reduce((s, r) => s + r.limit_cents, 0),
    total_actual_budgeted_cents: rows.reduce((s, r) => s + r.actual_cents, 0),
    unbudgeted,
    unbudgeted_total_cents: unbudgeted.reduce((s, u) => s + u.cents, 0),
    income_cents: f.income,
    spending_cents: f.spending,
    net_cents: f.net,
    fixed_cents: fixed,
    variable_cents: variable,
    fixed_categories: [...fixedSet].sort(),
  };
}
