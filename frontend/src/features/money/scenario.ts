/**
 * Purchase and affordability scenarios: the user's current position next to the
 * same position with a proposed change (a one-time purchase, paid in cash or
 * financed; a change in recurring spending; a change in income). Pure and
 * deterministic; every rule is a test in scenario.test.ts.
 *
 * Every output names its basis and whether it is user-entered or calculated.
 * The text describes what the numbers show; it is not advice and does not
 * guarantee that future obligations can be met.
 */

import { balances, debts, position } from "./ledger";
import { formatCents, isIsoDate, type MoneyState } from "./model";
import {
  addDays,
  addMonths,
  expandRecurring,
  isLiquid,
  liquidEffect,
  monthlyAverages,
  monthsUntil,
} from "./planInputs";

export interface Financing {
  financed_cents: number;
  apr: number;
  term_months: number;
}

export interface PurchaseInput {
  amount_cents: number;
  date: string;
  /** Account it is paid from. Null = liquid funds generally. */
  account_id: string | null;
  financing: Financing | null;
}

export interface MonthlyChange {
  /** Signed. Recurring spending: positive = more spending. Income: positive = more income. */
  monthly_cents: number;
  start_date: string;
}

export interface ScenarioInput {
  purchase: PurchaseInput | null;
  recurring_change: MonthlyChange | null;
  income_change: MonthlyChange | null;
}

export type Source = "user-entered" | "calculated";

export interface ScenarioRow {
  key: string;
  label: string;
  unit: "cents" | "months" | "ratio";
  current: number | null;
  proposed: number | null;
  source: Source;
  basis: string;
}

export interface GoalNeed {
  id: string;
  name: string;
  remaining_cents: number;
  months_left: number;
  required_monthly_cents: number;
  note: string | null;
}

export interface LowPoint {
  cents: number;
  date: string;
}

export interface ScenarioResult {
  problems: string[];
  rows: ScenarioRow[];
  financed_payment_cents: number | null;
  cash_outlay_cents: number;
  goals: GoalNeed[];
  goals_without_date: string[];
  goals_required_cents: number;
  low_point: { current: LowPoint; proposed: LowPoint };
  verdict: string;
  months_used: number;
}

export const PROJECTION_DAYS = 90;

/**
 * Standard amortized payment, P x r / (1 - (1 + r)^-n) with r = APR / 12,
 * rounded to the cent. At 0% APR it is P / n.
 */
export function amortizedPayment(
  principalCents: number,
  aprPercent: number,
  termMonths: number,
): number {
  if (principalCents <= 0 || termMonths <= 0) return 0;
  const r = aprPercent / 100 / 12;
  if (r === 0) return Math.round(principalCents / termMonths);
  return Math.round((principalCents * r) / (1 - Math.pow(1 + r, -termMonths)));
}

export function validateScenario(input: ScenarioInput): string[] {
  const problems: string[] = [];
  const p = input.purchase;
  if (p) {
    if (!Number.isSafeInteger(p.amount_cents) || p.amount_cents <= 0)
      problems.push("Enter a purchase amount greater than zero.");
    if (!isIsoDate(p.date)) problems.push("Enter the purchase date.");
    const f = p.financing;
    if (f) {
      if (f.financed_cents <= 0 || f.financed_cents > p.amount_cents)
        problems.push(
          "The financed amount must be above zero and no more than the price.",
        );
      if (!Number.isFinite(f.apr) || f.apr < 0)
        problems.push("Enter the loan's APR (0 or more).");
      if (!Number.isInteger(f.term_months) || f.term_months <= 0)
        problems.push("Enter the loan term in whole months.");
    }
  }
  for (const [change, name] of [
    [input.recurring_change, "recurring spending change"],
    [input.income_change, "income change"],
  ] as const) {
    if (change && !isIsoDate(change.start_date))
      problems.push(`Enter a start date for the ${name}.`);
  }
  return problems;
}

/** Lowest running liquid balance over the window, starting from `start` cents today. */
function lowPoint(
  start: number,
  asOf: string,
  events: { date: string; delta: number }[],
): LowPoint {
  const sorted = [...events].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  let running = start;
  let low: LowPoint = { cents: start, date: asOf };
  for (let i = 0; i < sorted.length; i++) {
    running += sorted[i].delta;
    const endOfDay =
      i + 1 === sorted.length || sorted[i + 1].date !== sorted[i].date;
    if (endOfDay && running < low.cents)
      low = { cents: running, date: sorted[i].date };
  }
  return low;
}

function monthlyEvents(
  change: MonthlyChange,
  sign: 1 | -1,
  from: string,
  to: string,
  limit = Infinity,
): { date: string; delta: number }[] {
  const out: { date: string; delta: number }[] = [];
  for (let k = 0; k < limit && k < 1000; k++) {
    const date = addMonths(change.start_date, k);
    if (date > to) break;
    if (date >= from) out.push({ date, delta: sign * change.monthly_cents });
  }
  return out;
}

export function goalNeeds(
  state: MoneyState,
  asOf: string,
): { goals: GoalNeed[]; without_date: string[] } {
  const settled = balances(state, asOf);
  const goals: GoalNeed[] = [];
  const withoutDate: string[] = [];
  for (const g of state.planning.goals) {
    const funded =
      g.linked_account_ids.length > 0
        ? g.linked_account_ids.reduce((s, id) => s + (settled.get(id) ?? 0), 0)
        : g.funded_cents;
    const remaining = Math.max(0, g.target_cents - funded);
    if (remaining === 0) continue;
    if (g.target_date == null) {
      withoutDate.push(g.name);
      continue;
    }
    const passed = g.target_date <= asOf;
    const months = passed ? 1 : monthsUntil(asOf, g.target_date);
    goals.push({
      id: g.id,
      name: g.name,
      remaining_cents: remaining,
      months_left: months,
      required_monthly_cents: Math.ceil(remaining / months),
      note: passed
        ? "Target date has passed; the whole remaining amount is shown as due now."
        : null,
    });
  }
  return { goals, without_date: withoutDate };
}

export function runScenario(
  state: MoneyState,
  asOf: string,
  input: ScenarioInput,
): ScenarioResult {
  const problems = validateScenario(input);
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const avg = monthlyAverages(state, asOf, 3);
  const liquid = position(state, asOf).liquid_assets;
  const target = state.planning.profile.emergency_months_target;
  const p = problems.length === 0 ? input.purchase : null;
  const recurring = problems.length === 0 ? input.recurring_change : null;
  const income = problems.length === 0 ? input.income_change : null;

  const payment = p?.financing
    ? amortizedPayment(
        p.financing.financed_cents,
        p.financing.apr,
        p.financing.term_months,
      )
    : null;
  const paidFrom = p?.account_id ? byId.get(p.account_id) : undefined;
  const hitsLiquid = p != null && (p.account_id == null || isLiquid(paidFrom));
  const outlay =
    p && hitsLiquid ? p.amount_cents - (p.financing?.financed_cents ?? 0) : 0;
  const liquidAfter = liquid - outlay;

  const essential = avg.essential_cents;
  const reserveMonths = (cents: number) =>
    essential != null && essential > 0 ? cents / essential : null;
  const reserveTarget =
    essential != null && target != null ? Math.round(essential * target) : null;

  const monthlyDelta =
    -(payment ?? 0) -
    (recurring?.monthly_cents ?? 0) +
    (income?.monthly_cents ?? 0);
  const surplusAfter =
    avg.surplus_cents == null ? null : avg.surplus_cents + monthlyDelta;

  const minimums = debts(state, asOf)
    .filter((d) => d.balance_cents > 0)
    .reduce((s, d) => s + (d.account.minimum_payment_cents ?? 0), 0);
  const incomeAfter =
    avg.income_cents == null
      ? null
      : avg.income_cents + (income?.monthly_cents ?? 0);
  const dti = (pay: number, inc: number | null) =>
    inc != null && inc > 0 ? pay / inc : null;

  const { goals, without_date } = goalNeeds(state, asOf);
  const goalsRequired = goals.reduce((s, g) => s + g.required_monthly_cents, 0);

  // 90-day projection from recurring items (and the proposed changes).
  const end = addDays(asOf, PROJECTION_DAYS - 1);
  const base = expandRecurring(state.planning.recurring, asOf, end)
    .map((o) => ({ date: o.date, delta: liquidEffect(o.item, byId) }))
    .filter((e) => e.delta !== 0);
  const extra: { date: string; delta: number }[] = [];
  if (p && outlay > 0 && p.date >= asOf && p.date <= end)
    extra.push({ date: p.date, delta: -outlay });
  if (p && p.financing && payment)
    for (const e of monthlyEvents(
      { monthly_cents: payment, start_date: addMonths(p.date, 1) },
      -1,
      asOf,
      end,
      p.financing.term_months,
    ))
      extra.push(e);
  if (recurring) extra.push(...monthlyEvents(recurring, -1, asOf, end));
  if (income) extra.push(...monthlyEvents(income, 1, asOf, end));
  // A purchase dated before today has already left liquid funds in "proposed".
  const proposedStart = p && p.date < asOf ? liquidAfter : liquid;
  const low = {
    current: lowPoint(liquid, asOf, base),
    proposed: lowPoint(proposedStart, asOf, [...base, ...extra]),
  };

  const months = avg.months_used;
  const window = `average of ${months} complete month${months === 1 ? "" : "s"} since tracking began`;
  const rows: ScenarioRow[] = [
    {
      key: "liquid",
      label: "Liquid funds",
      unit: "cents",
      current: liquid,
      proposed: liquidAfter,
      source: "calculated",
      basis:
        "Cash, checking, savings, and money market balances today, minus the part of the purchase not financed.",
    },
    {
      key: "essential",
      label: "Essential spending per month",
      unit: "cents",
      current: essential,
      proposed: essential,
      source: "calculated",
      basis: `Spending in your essential categories, ${window}.`,
    },
    {
      key: "reserve_target",
      label: "Emergency reserve target (months)",
      unit: "months",
      current: target,
      proposed: target,
      source: "user-entered",
      basis: "From your profile.",
    },
    {
      key: "reserve_target_cents",
      label: "Emergency reserve target",
      unit: "cents",
      current: reserveTarget,
      proposed: reserveTarget,
      source: "calculated",
      basis: "Target months x average essential spending.",
    },
    {
      key: "reserve_months",
      label: "Liquid funds in months of essential spending",
      unit: "months",
      current: reserveMonths(liquid),
      proposed: reserveMonths(liquidAfter),
      source: "calculated",
      basis: "Liquid funds ÷ average essential spending.",
    },
    {
      key: "surplus",
      label: "Monthly surplus",
      unit: "cents",
      current: avg.surplus_cents,
      proposed: surplusAfter,
      source: "calculated",
      basis: `Income minus spending, ${window}; proposed adds the entered changes and any loan payment.`,
    },
    {
      key: "dti",
      label: "Debt payments ÷ income",
      unit: "ratio",
      current: dti(minimums, avg.income_cents),
      proposed: dti(minimums + (payment ?? 0), incomeAfter),
      source: "calculated",
      basis:
        "Recorded minimum payments (plus the new loan payment) over average monthly income. Debts with no minimum recorded are left out.",
    },
    {
      key: "goals",
      label: "Needed each month for dated goals",
      unit: "cents",
      current: goals.length ? goalsRequired : null,
      proposed: goals.length ? goalsRequired : null,
      source: "calculated",
      basis:
        "For each goal with a target date: amount remaining ÷ months until that date.",
    },
    {
      key: "low_point",
      label: `Lowest liquid balance, next ${PROJECTION_DAYS} days`,
      unit: "cents",
      current: low.current.cents,
      proposed: low.proposed.cents,
      source: "calculated",
      basis:
        "Today's liquid funds plus recurring items as scheduled. Spending you have not set up as a recurring item is not included.",
    },
  ];
  if (payment != null) {
    rows.push({
      key: "loan_payment",
      label: "Loan payment per month",
      unit: "cents",
      current: null,
      proposed: payment,
      source: "calculated",
      basis: `Standard amortization of ${formatCents(p?.financing?.financed_cents)} at ${p?.financing?.apr}% APR over ${p?.financing?.term_months} months (user-entered terms).`,
    });
  }

  return {
    problems,
    rows,
    financed_payment_cents: payment,
    cash_outlay_cents: outlay,
    goals,
    goals_without_date: without_date,
    goals_required_cents: goalsRequired,
    low_point: low,
    verdict: verdict(
      liquidAfter,
      essential,
      target,
      avg.surplus_cents,
      surplusAfter,
      goalsRequired,
      goals.length,
      low,
    ),
    months_used: months,
  };
}

function verdict(
  liquidAfter: number,
  essential: number | null,
  target: number | null,
  surplus: number | null,
  surplusAfter: number | null,
  goalsRequired: number,
  goalCount: number,
  low: { current: LowPoint; proposed: LowPoint },
): string {
  const parts: string[] = [];
  if (essential == null || essential <= 0) {
    parts.push(
      "Essential spending could not be measured from complete months of records, so reserve months are not computed.",
    );
  } else {
    const m = (liquidAfter / essential).toFixed(1);
    parts.push(
      `This leaves ${formatCents(liquidAfter)} in liquid funds, about ${m} months of essential spending in reserve; ${target == null ? "no reserve target is set in your profile" : `your target is ${target} months`}.`,
    );
  }
  if (surplus != null && surplusAfter != null) {
    parts.push(
      `The average monthly surplus would go from ${formatCents(surplus)} to ${formatCents(surplusAfter)}.`,
    );
  } else {
    parts.push("Monthly surplus needs at least one complete month of records.");
  }
  if (goalCount > 0 && surplusAfter != null) {
    parts.push(
      `Dated goals need about ${formatCents(goalsRequired)} a month${surplusAfter < goalsRequired ? `, more than the ${formatCents(surplusAfter)} surplus with this change` : `, within the ${formatCents(surplusAfter)} surplus with this change`}.`,
    );
  }
  parts.push(
    `From recurring items alone, the lowest liquid balance over the next ${PROJECTION_DAYS} days would be ${formatCents(low.proposed.cents)} on ${low.proposed.date} (without the change: ${formatCents(low.current.cents)}).`,
  );
  return parts.join(" ");
}
