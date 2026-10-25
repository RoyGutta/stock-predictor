/**
 * Multi-debt payoff strategies and a lump-sum liquidity check. Pure and
 * deterministic; every rule is a test in debtPlan.test.ts.
 *
 * Simulation, each month, using ledger.payoff's convention:
 *   1. every open debt accrues interest = round(balance x APR / 12);
 *   2. every open debt receives its minimum (capped at what it now owes);
 *   3. what is left of the monthly budget goes to the first open debt in the
 *      strategy's order, then the next, until the money runs out.
 * The budget stays fixed, so when a debt is paid off its minimum is freed and
 * joins the extra ("roll-over"). Orders are set once from the starting balances.
 * A debt missing its APR or minimum payment is left out and reported; neither
 * is ever assumed to be zero.
 */

import { debts as ledgerDebts, position } from "./ledger";
import { formatCents, type MoneyState } from "./model";
import { addDays, monthlyAverages, obligationsWithin } from "./planInputs";

export interface PlanDebt {
  id: string;
  name: string;
  balance_cents: number;
  apr: number | null;
  minimum_cents: number | null;
}

export type Strategy = "avalanche" | "snowball" | "custom";

export const STRATEGY_LABELS: Record<Strategy, string> = {
  avalanche: "Highest rate first (avalanche)",
  snowball: "Smallest balance first (snowball)",
  custom: "Your order",
};

export interface ScheduleRow {
  id: string;
  interest_cents: number;
  payment_cents: number;
  balance_after_cents: number;
}

export interface ScheduleMonth {
  month: number;
  rows: ScheduleRow[];
  /** Budget left unspent after every debt was paid this month. */
  unspent_cents: number;
}

export interface StrategyResult {
  strategy: Strategy;
  order: string[];
  feasible: boolean;
  reason: string | null;
  months: number | null;
  total_interest_cents: number | null;
  /** Month each debt reaches zero (0 = already zero). Null when it never does. */
  payoff_month: Record<string, number | null>;
  schedule: ScheduleMonth[];
}

export interface MissingDebt {
  id: string;
  name: string;
  missing: string[];
}

export interface DebtPlan {
  included: Known[];
  missing: MissingDebt[];
  sum_minimums_cents: number;
  budget_cents: number;
  results: Record<Strategy, StrategyResult>;
}

export const MAX_PLAN_MONTHS = 600;

// --- ordering ------------------------------------------------------------------

export type Known = PlanDebt & { apr: number; minimum_cents: number };

const byName = (a: PlanDebt, b: PlanDebt) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function avalancheOrder(list: Known[]): string[] {
  return [...list]
    .sort(
      (a, b) =>
        b.apr - a.apr || a.balance_cents - b.balance_cents || byName(a, b),
    )
    .map((d) => d.id);
}

export function snowballOrder(list: Known[]): string[] {
  return [...list]
    .sort(
      (a, b) =>
        a.balance_cents - b.balance_cents || b.apr - a.apr || byName(a, b),
    )
    .map((d) => d.id);
}

/** The user's order; debts they did not place follow in avalanche order. */
export function customOrder(list: Known[], userOrder: string[]): string[] {
  const ids = new Set(list.map((d) => d.id));
  const placed = userOrder.filter(
    (id, i) => ids.has(id) && userOrder.indexOf(id) === i,
  );
  const rest = avalancheOrder(list).filter((id) => !placed.includes(id));
  return [...placed, ...rest];
}

// --- simulation ----------------------------------------------------------------

function infeasible(
  strategy: Strategy,
  order: string[],
  reason: string,
  payoffMonth: Record<string, number | null>,
): StrategyResult {
  return {
    strategy,
    order,
    feasible: false,
    reason,
    months: null,
    total_interest_cents: null,
    payoff_month: payoffMonth,
    schedule: [],
  };
}

export function simulate(
  list: Known[],
  budgetCents: number,
  strategy: Strategy,
  order: string[],
): StrategyResult {
  const payoffMonth: Record<string, number | null> = {};
  const balance = new Map<string, number>();
  for (const d of list) {
    payoffMonth[d.id] = d.balance_cents <= 0 ? 0 : null;
    if (d.balance_cents > 0) balance.set(d.id, d.balance_cents);
  }
  const open = list.filter((d) => d.balance_cents > 0);
  const minimums = open.reduce((s, d) => s + d.minimum_cents, 0);
  if (budgetCents < minimums) {
    return infeasible(
      strategy,
      order,
      `The monthly budget of ${formatCents(budgetCents)} is ${formatCents(minimums - budgetCents)} less than the ${formatCents(minimums)} sum of minimum payments.`,
      payoffMonth,
    );
  }
  const rate = (d: Known) => d.apr / 100 / 12;
  const extra0 = budgetCents - minimums;
  if (extra0 === 0) {
    for (const d of open) {
      const interest = Math.round(d.balance_cents * rate(d));
      if (d.minimum_cents <= interest) {
        return infeasible(
          strategy,
          order,
          `${d.name}: the minimum payment of ${formatCents(d.minimum_cents)} does not exceed the first month's interest of ${formatCents(interest)}, and the budget leaves no extra to send to it, so its balance would not fall.`,
          payoffMonth,
        );
      }
    }
  }

  const schedule: ScheduleMonth[] = [];
  let interestTotal = 0;
  for (let month = 1; month <= MAX_PLAN_MONTHS; month++) {
    const rows = new Map<string, ScheduleRow>();
    let available = budgetCents;
    for (const d of open) {
      const owed = balance.get(d.id) ?? 0;
      if (owed <= 0) continue;
      const interest = Math.round(owed * rate(d));
      interestTotal += interest;
      const due = owed + interest;
      const pay = Math.min(d.minimum_cents, due);
      available -= pay;
      balance.set(d.id, due - pay);
      rows.set(d.id, {
        id: d.id,
        interest_cents: interest,
        payment_cents: pay,
        balance_after_cents: due - pay,
      });
    }
    for (const id of order) {
      if (available <= 0) break;
      const owed = balance.get(id) ?? 0;
      const row = rows.get(id);
      if (owed <= 0 || !row) continue;
      const pay = Math.min(available, owed);
      available -= pay;
      balance.set(id, owed - pay);
      row.payment_cents += pay;
      row.balance_after_cents = owed - pay;
    }
    for (const row of rows.values()) {
      if (row.balance_after_cents <= 0 && payoffMonth[row.id] == null) {
        payoffMonth[row.id] = month;
      }
    }
    schedule.push({
      month,
      rows: [...rows.values()],
      unspent_cents: available,
    });
    if (open.every((d) => (balance.get(d.id) ?? 0) <= 0)) {
      return {
        strategy,
        order,
        feasible: true,
        reason: null,
        months: month,
        total_interest_cents: interestTotal,
        payoff_month: payoffMonth,
        schedule,
      };
    }
  }
  const stuck = open.filter((d) => payoffMonth[d.id] == null);
  const names = stuck.map((d) => d.name).join(", ");
  return infeasible(
    strategy,
    order,
    `Not every debt is paid off within ${MAX_PLAN_MONTHS / 12} years at this budget and order (still owed: ${names}). A minimum payment that does not exceed a debt's interest only works if extra money reaches that debt.`,
    payoffMonth,
  );
}

/** Split debts into those with every input and those missing APR or minimum. */
export function partitionDebts(list: PlanDebt[]): {
  known: Known[];
  missing: MissingDebt[];
} {
  const known: Known[] = [];
  const missing: MissingDebt[] = [];
  for (const d of list) {
    const gaps: string[] = [];
    if (d.apr == null) gaps.push("interest rate (APR)");
    if (d.minimum_cents == null) gaps.push("minimum payment");
    if (gaps.length > 0)
      missing.push({ id: d.id, name: d.name, missing: gaps });
    else known.push(d as Known);
  }
  return { known, missing };
}

export function planDebts(
  list: PlanDebt[],
  budgetCents: number,
  userOrder: string[] = [],
): DebtPlan {
  const { known, missing } = partitionDebts(list);
  const orders: Record<Strategy, string[]> = {
    avalanche: avalancheOrder(known),
    snowball: snowballOrder(known),
    custom: customOrder(known, userOrder),
  };
  const results = {} as Record<Strategy, StrategyResult>;
  for (const s of ["avalanche", "snowball", "custom"] as Strategy[]) {
    results[s] = simulate(known, budgetCents, s, orders[s]);
  }
  return {
    included: known,
    missing,
    sum_minimums_cents: known
      .filter((d) => d.balance_cents > 0)
      .reduce((s, d) => s + d.minimum_cents, 0),
    budget_cents: budgetCents,
    results,
  };
}

export interface Comparison {
  /** b.months - a.months: positive means `a` is debt-free sooner. */
  months_difference: number | null;
  /** b.interest - a.interest: positive means `a` costs less interest. */
  interest_difference_cents: number | null;
}

export function compareResults(
  a: StrategyResult,
  b: StrategyResult,
): Comparison {
  if (!a.feasible || !b.feasible) {
    return { months_difference: null, interest_difference_cents: null };
  }
  return {
    months_difference: (b.months ?? 0) - (a.months ?? 0),
    interest_difference_cents:
      (b.total_interest_cents ?? 0) - (a.total_interest_cents ?? 0),
  };
}

// --- inputs from the user's records --------------------------------------------

/** Open USD debts from the ledger, plus the default budget (planned, else minimum, per debt). */
export function debtsFromState(
  state: MoneyState,
  asOf: string,
): { debts: PlanDebt[]; default_budget_cents: number; paid_off: string[] } {
  const rows = ledgerDebts(state, asOf);
  const open = rows.filter((r) => r.balance_cents > 0);
  return {
    debts: open.map((r) => ({
      id: r.account.id,
      name: r.account.name,
      balance_cents: r.balance_cents,
      apr: r.account.apr,
      minimum_cents: r.account.minimum_payment_cents,
    })),
    default_budget_cents: open.reduce(
      (s, r) =>
        s +
        (r.account.planned_payment_cents ??
          r.account.minimum_payment_cents ??
          0),
      0,
    ),
    paid_off: rows
      .filter((r) => r.balance_cents <= 0)
      .map((r) => r.account.name),
  };
}

// --- liquidity check -----------------------------------------------------------

export interface LiquidityInput {
  liquid_cents: number;
  /** Average monthly essential spending. Null when it could not be measured. */
  essential_monthly_cents: number | null;
  /** Recurring money leaving liquid funds in the next 30 days. */
  obligations_30d_cents: number;
  /** From the profile. Null when the user has not set one. */
  emergency_months_target: number | null;
}

export interface LiquidityResult {
  reserve_cents: number | null;
  /** Most that could go to a lump-sum payment while keeping the reserve and the next 30 days' obligations. */
  available_cents: number | null;
  /** min(requested, available), when a request is given. */
  usable_cents: number | null;
  reason: string | null;
}

export function liquidityCheck(
  input: LiquidityInput,
  requestedCents: number | null = null,
): LiquidityResult {
  const none = (reason: string): LiquidityResult => ({
    reserve_cents: null,
    available_cents: null,
    usable_cents: null,
    reason,
  });
  if (
    input.emergency_months_target == null ||
    input.emergency_months_target <= 0
  ) {
    return none(
      "No emergency reserve target is set in your profile, so the amount to keep back cannot be sized.",
    );
  }
  if (input.essential_monthly_cents == null) {
    return none(
      "Essential spending could not be measured: there is no complete month of records yet.",
    );
  }
  if (input.essential_monthly_cents <= 0) {
    return none(
      "No spending in your essential categories was recorded, so a reserve cannot be sized from it.",
    );
  }
  const reserve = Math.round(
    input.essential_monthly_cents * input.emergency_months_target,
  );
  const available = Math.max(
    0,
    input.liquid_cents - reserve - input.obligations_30d_cents,
  );
  return {
    reserve_cents: reserve,
    available_cents: available,
    usable_cents:
      requestedCents == null ? null : Math.min(requestedCents, available),
    reason: null,
  };
}

/** Liquidity inputs from the user's records as of `asOf`. */
export function liquidityInputs(
  state: MoneyState,
  asOf: string,
): LiquidityInput & { months_used: number } {
  const avg = monthlyAverages(state, asOf, 3);
  return {
    liquid_cents: position(state, asOf).liquid_assets,
    essential_monthly_cents: avg.essential_cents,
    obligations_30d_cents: obligationsWithin(state, asOf, addDays(asOf, 29)),
    emergency_months_target: state.planning.profile.emergency_months_target,
    months_used: avg.months_used,
  };
}
