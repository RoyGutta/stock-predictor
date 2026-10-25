/**
 * Cash-flow projection: pure, deterministic, local. It is arithmetic on the
 * user's own entries, not a prediction:
 *
 * - Starts from today's SETTLED balances (ledger.balances). Pending transactions
 *   are listed separately with their effect and are not applied.
 * - Applies each recurring item's occurrences dated from today through the end
 *   of the horizon (end_date inclusive), using ledger.effectsOf, so a transfer
 *   moves money between accounts exactly as a recorded transfer would.
 * - Monthly goal contributions are applied only when the caller opts in.
 * - Only active (not archived) USD accounts are projected; anything else is
 *   listed as skipped, never silently dropped.
 * - Every projected event carries "fixed" or "estimated" from the user's entry.
 */

import { balances, effectsOf, type Effect } from "./ledger";
import {
  ACCOUNT_TYPES,
  isLiability,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";
import type { Cadence, Goal, RecurringItem } from "./planning";

// --- calendar dates (UTC arithmetic on YYYY-MM-DD) ------------------------------

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/**
 * Add calendar months, keeping the day of month and clamping to the last day
 * when the target month is shorter: Jan 31 + 1 month = Feb 28 (or 29).
 */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = index - ty * 12; // 0-based
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(ty).padStart(4, "0")}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const STEP: Record<Cadence, { unit: "day" | "month"; size: number }> = {
  weekly: { unit: "day", size: 7 },
  biweekly: { unit: "day", size: 14 },
  monthly: { unit: "month", size: 1 },
  quarterly: { unit: "month", size: 3 },
  yearly: { unit: "month", size: 12 },
};

/**
 * Dates on which a recurring item falls within [from, to], inclusive, stopping
 * after `end_date` (inclusive). Month-based cadences are computed from the
 * anchor date each time (anchor + k months, clamped), so a Jan 31 item falls on
 * Feb 28 and then Mar 31, never drifting to the 28th.
 */
export function expandOccurrences(
  item: Pick<RecurringItem, "cadence" | "next_date" | "end_date">,
  from: string,
  to: string,
): string[] {
  const out: string[] = [];
  const step = STEP[item.cadence];
  const stop = item.end_date && item.end_date < to ? item.end_date : to;
  for (let k = 0; k < 2000; k++) {
    const date =
      step.unit === "day"
        ? addDays(item.next_date, k * step.size)
        : addMonthsClamped(item.next_date, k * step.size);
    if (date > stop) break;
    if (date >= from) out.push(date);
  }
  return out;
}

// --- projection -------------------------------------------------------------------

export type Horizon = 30 | 90 | 365;
export const HORIZONS: Horizon[] = [30, 90, 365];

export interface ForecastOptions {
  asOf: string;
  horizonDays: Horizon;
  /** Liquid balance the user wants to stay above. Null = not set. */
  thresholdCents?: number | null;
  /** Apply each goal's planned monthly contribution. Off unless the user opts in. */
  includeGoalContributions?: boolean;
}

export interface ProjectedEvent {
  date: string;
  description: string;
  source: "recurring" | "goal";
  source_id: string;
  kind: "income" | "expense" | "transfer" | "goal_contribution";
  certainty: "fixed" | "estimated";
  amount_cents: number;
  /** Per-account changes, natural sign. Empty for goal contributions. */
  effects: Effect[];
  /** Change in total liquid funds caused by this event. */
  liquid_delta_cents: number;
  liquid_after_cents: number;
}

export interface AccountProjection {
  account_id: string;
  name: string;
  liquid: boolean;
  liability: boolean;
  confirmed_cents: number;
  projected_end_cents: number;
}

export interface Forecast {
  as_of: string;
  end_date: string;
  horizon_days: Horizon;
  /** Settled liquid funds today. Never mixed with projected figures. */
  confirmed_liquid_cents: number;
  accounts: AccountProjection[];
  pending: { transactions: Transaction[]; liquid_effect_cents: number };
  events: ProjectedEvent[];
  /** End-of-day projected liquid funds for every day from as_of to end_date. */
  daily: { date: string; liquid_cents: number }[];
  lowest: { cents: number; date: string };
  first_below_zero: string | null;
  threshold_cents: number | null;
  first_below_threshold: string | null;
  /** Projected liquid funds at the end of the horizon, after every event. */
  money_left_cents: number;
  inflow_cents: number;
  outflow_cents: number;
  fixed_count: number;
  estimated_count: number;
  goal_contributions_included: boolean;
  /** Entries left out of the projection, each with the reason. */
  skipped: string[];
}

function projectable(a: Account | undefined): a is Account {
  return !!a && !a.archived && a.currency === "USD";
}

function isLiquidAsset(a: Account): boolean {
  return !isLiability(a) && ACCOUNT_TYPES[a.type].liquid;
}

function recurringAsTransaction(
  item: RecurringItem,
  date: string,
): Transaction {
  return {
    id: `${item.id}@${date}`,
    date,
    kind: item.kind,
    amount_cents: item.amount_cents,
    account_id: item.account_id,
    to_account_id: item.to_account_id,
    interest_cents: 0,
    category: item.category,
    splits: [],
    description: item.description,
    notes: "",
    status: "settled",
  };
}

/** Where a goal contribution goes, and whether it leaves liquid funds. */
function goalLiquidDelta(goal: Goal, byId: Map<string, Account>): number {
  const target = goal.linked_account_ids
    .map((id) => byId.get(id))
    .find(projectable);
  // Moving money into a liquid account the user owns keeps it in liquid funds.
  if (target && isLiquidAsset(target)) return 0;
  return -(goal.monthly_contribution_cents ?? 0);
}

export function projectCashFlow(
  state: MoneyState,
  options: ForecastOptions,
): Forecast {
  const { asOf, horizonDays } = options;
  const threshold = options.thresholdCents ?? null;
  const includeGoals = options.includeGoalContributions ?? false;
  const end = addDays(asOf, horizonDays);
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const settled = balances(state, asOf);
  const active = state.accounts.filter(projectable);
  const skipped: string[] = state.accounts
    .filter((a) => a.archived || a.currency !== "USD")
    .map((a: Account) =>
      a.archived
        ? `${a.name}: archived`
        : `${a.name}: not in U.S. dollars (${a.currency})`,
    );

  const running = new Map(active.map((a) => [a.id, settled.get(a.id) ?? 0]));
  const confirmedLiquid = active
    .filter(isLiquidAsset)
    .reduce((s, a) => s + (settled.get(a.id) ?? 0), 0);

  const liquidDelta = (effects: Effect[]) =>
    effects.reduce((s, e) => {
      const a = byId.get(e.account_id);
      return a && projectable(a) && isLiquidAsset(a) ? s + e.delta : s;
    }, 0);

  type Draft = Omit<ProjectedEvent, "liquid_after_cents">;
  const drafts: Draft[] = [];
  for (const item of state.planning.recurring) {
    const from = byId.get(item.account_id);
    const to = item.to_account_id ? byId.get(item.to_account_id) : undefined;
    if (!projectable(from) || (item.kind === "transfer" && !projectable(to))) {
      skipped.push(
        `${item.description}: its account is missing, archived, or not in U.S. dollars`,
      );
      continue;
    }
    for (const date of expandOccurrences(item, asOf, end)) {
      const effects = effectsOf(recurringAsTransaction(item, date), byId);
      drafts.push({
        date,
        description: item.description,
        source: "recurring",
        source_id: item.id,
        kind: item.kind,
        certainty: item.certainty,
        amount_cents: item.amount_cents,
        effects,
        liquid_delta_cents: liquidDelta(effects),
      });
    }
  }
  if (includeGoals) {
    for (const goal of state.planning.goals) {
      const c = goal.monthly_contribution_cents;
      if (c == null || c <= 0) continue;
      // Contributions are placed on the first day of each month in the horizon.
      let date = addMonthsClamped(`${asOf.slice(0, 7)}-01`, 1);
      while (date <= end) {
        drafts.push({
          date,
          description: `Contribution to ${goal.name}`,
          source: "goal",
          source_id: goal.id,
          kind: "goal_contribution",
          certainty: "fixed",
          amount_cents: c,
          effects: [],
          liquid_delta_cents: goalLiquidDelta(goal, byId),
        });
        date = addMonthsClamped(date, 1);
      }
    }
  }
  // Same-day order: money in before money out, then by description, so the
  // result does not depend on the order items were entered.
  drafts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      b.liquid_delta_cents - a.liquid_delta_cents ||
      a.description.localeCompare(b.description),
  );

  let liquid = confirmedLiquid;
  const events: ProjectedEvent[] = [];
  let inflow = 0;
  let outflow = 0;
  for (const d of drafts) {
    for (const e of d.effects) {
      if (running.has(e.account_id))
        running.set(e.account_id, (running.get(e.account_id) ?? 0) + e.delta);
    }
    liquid += d.liquid_delta_cents;
    if (d.liquid_delta_cents > 0) inflow += d.liquid_delta_cents;
    else outflow -= d.liquid_delta_cents;
    events.push({ ...d, liquid_after_cents: liquid });
  }

  const daily: { date: string; liquid_cents: number }[] = [];
  let level = confirmedLiquid;
  let i = 0;
  for (let day = 0; day <= horizonDays; day++) {
    const date = addDays(asOf, day);
    while (i < events.length && events[i].date === date) {
      level = events[i].liquid_after_cents;
      i++;
    }
    daily.push({ date, liquid_cents: level });
  }
  const lowest = daily.reduce(
    (low, p) =>
      p.liquid_cents < low.cents
        ? { cents: p.liquid_cents, date: p.date }
        : low,
    { cents: daily[0].liquid_cents, date: daily[0].date },
  );
  const firstBelow = (limit: number) =>
    daily.find((p) => p.liquid_cents < limit)?.date ?? null;

  const pendingTx = state.transactions.filter(
    (t) => t.status === "pending" && t.date <= asOf,
  );
  const pendingEffect = pendingTx.reduce(
    (s, t) => s + liquidDelta(effectsOf(t, byId)),
    0,
  );

  return {
    as_of: asOf,
    end_date: end,
    horizon_days: horizonDays,
    confirmed_liquid_cents: confirmedLiquid,
    accounts: active.map((a) => ({
      account_id: a.id,
      name: a.name,
      liquid: isLiquidAsset(a),
      liability: isLiability(a),
      confirmed_cents: settled.get(a.id) ?? 0,
      projected_end_cents: running.get(a.id) ?? 0,
    })),
    pending: { transactions: pendingTx, liquid_effect_cents: pendingEffect },
    events,
    daily,
    lowest,
    first_below_zero: firstBelow(0),
    threshold_cents: threshold,
    first_below_threshold: threshold == null ? null : firstBelow(threshold),
    money_left_cents: liquid,
    inflow_cents: inflow,
    outflow_cents: outflow,
    fixed_count: events.filter((e) => e.certainty === "fixed").length,
    estimated_count: events.filter((e) => e.certainty === "estimated").length,
    goal_contributions_included: includeGoals,
    skipped,
  };
}
