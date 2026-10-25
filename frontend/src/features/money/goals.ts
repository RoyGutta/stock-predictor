/**
 * Goal arithmetic: pure, deterministic, local. No investment return is assumed
 * anywhere except `projectWithReturn`, which is a labelled hypothetical.
 *
 * - Funded = sum of settled balances of linked USD asset accounts when any are
 *   linked, else the amount the user entered.
 * - Required monthly = ceil(remaining / whole calendar months from asOf to the
 *   target date), at least one month. No target date = null with a reason.
 * - Completion at the planned contribution = asOf + ceil(remaining / planned)
 *   months (month-end clamped). No or zero contribution = null with a reason.
 * - Feasibility compares required amounts, highest priority first, with the
 *   average monthly surplus of complete tracked months minus recurring
 *   commitments that are not already counted in spending.
 */

import { balances, completeMonths } from "./ledger";
import { isLiability, type MoneyState } from "./model";
import type { Cadence, Goal, RecurringItem } from "./planning";
import { addMonthsClamped } from "./forecast";

/** Whole calendar months from `from` to `to`; a partial month does not count. */
export function wholeMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) {
    // Count the month only when the clamped anniversary has been reached.
    const anniversary = addMonthsClamped(from, months);
    if (to < anniversary) months -= 1;
  }
  return months;
}

export type GoalStatusCode =
  "reached" | "on_track" | "behind" | "past_due" | "no_date" | "no_plan";

export interface GoalProgress {
  goal: Goal;
  funded_cents: number;
  funded_basis: "linked_accounts" | "entered";
  /** Linked accounts left out of the funded amount, with the reason. */
  funded_notes: string[];
  /** funded / target, 0 to 1 (capped at 1). */
  progress: number;
  remaining_cents: number;
  months_to_target: number | null;
  required_monthly_cents: number | null;
  required_reason: string | null;
  completion_date: string | null;
  completion_months: number | null;
  completion_reason: string | null;
  status: GoalStatusCode;
  status_text: string;
}

export function fundedAmount(
  goal: Goal,
  state: MoneyState,
  asOf: string,
): Pick<GoalProgress, "funded_cents" | "funded_basis" | "funded_notes"> {
  if (goal.linked_account_ids.length === 0) {
    return {
      funded_cents: goal.funded_cents,
      funded_basis: "entered",
      funded_notes: [],
    };
  }
  const settled = balances(state, asOf);
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  let sum = 0;
  const notes: string[] = [];
  for (const id of goal.linked_account_ids) {
    const a = byId.get(id);
    if (!a) notes.push("A linked account no longer exists.");
    else if (isLiability(a))
      notes.push(
        `${a.name} is a debt, so it is not counted as money set aside.`,
      );
    else if (a.currency !== "USD")
      notes.push(`${a.name} is not in U.S. dollars.`);
    else sum += settled.get(id) ?? 0;
  }
  return {
    funded_cents: sum,
    funded_basis: "linked_accounts",
    funded_notes: notes,
  };
}

export function goalProgress(
  goal: Goal,
  state: MoneyState,
  asOf: string,
): GoalProgress {
  const funded = fundedAmount(goal, state, asOf);
  const remaining = Math.max(0, goal.target_cents - funded.funded_cents);
  const progress =
    goal.target_cents > 0
      ? Math.min(1, Math.max(0, funded.funded_cents / goal.target_cents))
      : 0;

  let months: number | null = null;
  let required: number | null = null;
  let requiredReason: string | null = null;
  if (remaining === 0) {
    required = 0;
  } else if (goal.target_date == null) {
    requiredReason = "No target date is set.";
  } else {
    months = Math.max(1, wholeMonthsBetween(asOf, goal.target_date));
    required = Math.ceil(remaining / months);
    if (goal.target_date <= asOf)
      requiredReason =
        "The target date has passed; the whole remainder is shown as due in one month.";
  }

  const planned = goal.monthly_contribution_cents;
  let completion: string | null = null;
  let completionMonths: number | null = null;
  let completionReason: string | null = null;
  if (remaining === 0) {
    completion = asOf;
    completionMonths = 0;
  } else if (planned == null) {
    completionReason = "No monthly contribution is planned.";
  } else if (planned <= 0) {
    completionReason = "The planned monthly contribution is zero.";
  } else {
    completionMonths = Math.ceil(remaining / planned);
    completion = addMonthsClamped(asOf, completionMonths);
  }

  let status: GoalStatusCode;
  let text: string;
  if (remaining === 0) {
    status = "reached";
    text = "Target reached";
  } else if (goal.target_date == null) {
    status = "no_date";
    text = "No target date, so on-track cannot be assessed";
  } else if (goal.target_date <= asOf) {
    status = "past_due";
    text = "Target date has passed with money still remaining";
  } else if (planned == null || planned <= 0) {
    status = "no_plan";
    text = "No monthly contribution planned";
  } else if (planned >= (required ?? 0)) {
    status = "on_track";
    text = "Planned contribution meets the required amount";
  } else {
    status = "behind";
    text = "Planned contribution is below the required amount";
  }

  return {
    goal,
    ...funded,
    progress,
    remaining_cents: remaining,
    months_to_target: months,
    required_monthly_cents: required,
    required_reason: requiredReason,
    completion_date: completion,
    completion_months: completionMonths,
    completion_reason: completionReason,
    status,
    status_text: text,
  };
}

// --- hypothetical return scenario ----------------------------------------------

export interface ReturnScenario {
  /** Always true: this is arithmetic under an assumed rate, not an expectation. */
  hypothetical: true;
  months: number | null;
  contributed_cents: number | null;
  growth_cents: number | null;
  reason: string | null;
  basis: string;
}

/**
 * HYPOTHETICAL. Months for monthly contributions to reach `remaining` if they
 * earned a constant `annualRatePercent`, compounded monthly (rate / 12), each
 * contribution made at the end of the month. Only new contributions earn the
 * assumed rate. Balances are rounded to the cent each month. Returns are not
 * constant and can be negative; this is not an expected outcome.
 */
export function projectWithReturn(
  remainingCents: number,
  contributionCents: number,
  annualRatePercent: number,
): ReturnScenario {
  const basis = `Hypothetical: assumes a constant ${annualRatePercent}% a year, compounded monthly, on new contributions only. Not an expected return.`;
  const fail = (reason: string): ReturnScenario => ({
    hypothetical: true,
    months: null,
    contributed_cents: null,
    growth_cents: null,
    reason,
    basis,
  });
  if (
    !Number.isFinite(annualRatePercent) ||
    annualRatePercent < 0 ||
    annualRatePercent > 30
  )
    return fail("Enter a rate between 0 and 30 percent.");
  if (remainingCents <= 0)
    return {
      hypothetical: true,
      months: 0,
      contributed_cents: 0,
      growth_cents: 0,
      reason: null,
      basis,
    };
  if (!(contributionCents > 0))
    return fail("Enter a monthly amount greater than zero.");
  const r = annualRatePercent / 100 / 12;
  let balance = 0;
  for (let month = 1; month <= 1200; month++) {
    balance = Math.round(balance * (1 + r)) + contributionCents;
    if (balance >= remainingCents) {
      const contributed = month * contributionCents;
      return {
        hypothetical: true,
        months: month,
        contributed_cents: contributed,
        growth_cents: balance - contributed,
        reason: null,
        basis,
      };
    }
  }
  return fail("Not reached within 100 years at this amount.");
}

// --- what-if comparison -----------------------------------------------------------

export interface ScenarioChange {
  target_date?: string | null;
  monthly_contribution_cents?: number | null;
}

export function compareScenario(
  goal: Goal,
  change: ScenarioChange,
  state: MoneyState,
  asOf: string,
): { current: GoalProgress; scenario: GoalProgress } {
  return {
    current: goalProgress(goal, state, asOf),
    scenario: goalProgress({ ...goal, ...change }, state, asOf),
  };
}

// --- feasibility ----------------------------------------------------------------

/** Monthly equivalent of a recurring amount: weekly x 52/12, biweekly x 26/12. */
export function monthlyEquivalent(
  amountCents: number,
  cadence: Cadence,
): number {
  const factor: Record<Cadence, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  };
  return Math.round(amountCents * factor[cadence]);
}

export interface Commitment {
  item: RecurringItem;
  monthly_cents: number;
  reason: string;
}

export interface FeasibilityRow {
  progress: GoalProgress;
  /** Monthly amount this goal needs, and where it comes from. */
  needed_cents: number | null;
  needed_basis: "required" | "planned" | null;
  cumulative_cents: number | null;
  fits: boolean | null;
  /** How far the goals up to and including this one exceed what is available. */
  shortfall_cents: number | null;
  /** Earliest target date that would fit in what is left after higher priorities. */
  fits_by_date: string | null;
  note: string;
}

export interface Feasibility {
  months: string[];
  average_income_cents: number | null;
  average_spending_cents: number | null;
  average_surplus_cents: number | null;
  commitments: Commitment[];
  commitments_cents: number;
  available_cents: number | null;
  available_reason: string | null;
  rows: FeasibilityRow[];
  total_needed_cents: number;
}

/**
 * Recurring outflows not already inside recorded spending: expenses with no
 * settled expense of the same category and amount (or the same description)
 * in the averaged months, plus payments to debts, which are transfers and are
 * never counted as spending.
 */
function uncountedCommitments(
  state: MoneyState,
  asOf: string,
  start: string | null,
  end: string | null,
): Commitment[] {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const recorded = state.transactions.filter(
    (t) =>
      t.kind === "expense" &&
      t.status === "settled" &&
      start != null &&
      end != null &&
      t.date >= start &&
      t.date <= end,
  );
  const out: Commitment[] = [];
  for (const item of state.planning.recurring) {
    if (item.end_date != null && item.end_date < asOf) continue;
    const monthly = monthlyEquivalent(item.amount_cents, item.cadence);
    if (item.kind === "expense") {
      const seen = recorded.some(
        (t) =>
          (t.category === item.category &&
            t.amount_cents === item.amount_cents) ||
          t.description.trim().toLowerCase() ===
            item.description.trim().toLowerCase(),
      );
      if (!seen)
        out.push({
          item,
          monthly_cents: monthly,
          reason: "Not found in the recorded spending used for the average",
        });
    } else if (item.kind === "transfer") {
      const to = item.to_account_id ? byId.get(item.to_account_id) : undefined;
      if (to && isLiability(to))
        out.push({
          item,
          monthly_cents: monthly,
          reason: "Debt payment: a transfer, never counted as spending",
        });
    }
  }
  return out;
}

function byPriority(a: GoalProgress, b: GoalProgress): number {
  return (
    a.goal.priority - b.goal.priority ||
    (a.goal.target_date ?? "9999-12-31").localeCompare(
      b.goal.target_date ?? "9999-12-31",
    ) ||
    a.goal.name.localeCompare(b.goal.name)
  );
}

export function feasibility(
  state: MoneyState,
  asOf: string,
  monthCount = 6,
): Feasibility {
  const trackingSince = state.accounts.reduce(
    (min, a) => (a.opening_date < min ? a.opening_date : min),
    "9999-12-31",
  );
  const months = completeMonths(state, asOf, monthCount).filter(
    (m) => m.end >= trackingSince,
  );
  const n = months.length;
  const avg = (pick: (m: (typeof months)[number]) => number) =>
    n ? Math.round(months.reduce((s, m) => s + pick(m), 0) / n) : null;
  const income = avg((m) => m.income);
  const spending = avg((m) => m.spending);
  const surplus = income == null || spending == null ? null : income - spending;
  const window = n ? { start: months[0].start, end: months[n - 1].end } : null;
  const commitments = uncountedCommitments(
    state,
    asOf,
    window?.start ?? null,
    window?.end ?? null,
  );
  const committed = commitments.reduce((s, c) => s + c.monthly_cents, 0);
  const available = surplus == null ? null : surplus - committed;

  const rows: FeasibilityRow[] = [];
  let cumulative = 0;
  const sorted = state.planning.goals
    .map((g) => goalProgress(g, state, asOf))
    .sort(byPriority);
  for (const p of sorted) {
    let needed: number | null = p.required_monthly_cents;
    let basis: FeasibilityRow["needed_basis"] =
      needed == null ? null : "required";
    if (needed == null && p.goal.monthly_contribution_cents != null) {
      needed = p.goal.monthly_contribution_cents;
      basis = "planned";
    }
    if (needed == null) {
      rows.push({
        progress: p,
        needed_cents: null,
        needed_basis: null,
        cumulative_cents: null,
        fits: null,
        shortfall_cents: null,
        fits_by_date: null,
        note: "Not assessed: no target date and no planned monthly amount.",
      });
      continue;
    }
    const before = cumulative;
    cumulative += needed;
    if (available == null) {
      rows.push({
        progress: p,
        needed_cents: needed,
        needed_basis: basis,
        cumulative_cents: cumulative,
        fits: null,
        shortfall_cents: null,
        fits_by_date: null,
        note: "Not assessed: no complete month of income and spending is recorded yet.",
      });
      continue;
    }
    const fits = cumulative <= available;
    const left = available - before;
    let fitsBy: string | null = null;
    if (!fits && left > 0 && p.remaining_cents > 0)
      fitsBy = addMonthsClamped(asOf, Math.ceil(p.remaining_cents / left));
    rows.push({
      progress: p,
      needed_cents: needed,
      needed_basis: basis,
      cumulative_cents: cumulative,
      fits,
      shortfall_cents: fits ? 0 : Math.min(needed, cumulative - available),
      fits_by_date: fitsBy,
      note: fits
        ? "Fits after every higher-priority goal is funded."
        : left > 0
          ? "Conflicts: only part of what it needs is left after higher-priority goals."
          : "Conflicts: nothing is left after higher-priority goals.",
    });
  }
  return {
    months: months.map((m) => m.month),
    average_income_cents: income,
    average_spending_cents: spending,
    average_surplus_cents: surplus,
    commitments,
    commitments_cents: committed,
    available_cents: available,
    available_reason:
      available == null
        ? `No complete month has passed since tracking began (${trackingSince === "9999-12-31" ? "no accounts yet" : trackingSince}).`
        : null,
    rows,
    total_needed_cents: cumulative,
  };
}
