/**
 * Validation for the v2 planning entities (see planning.ts). Same discipline as
 * store.ts: every field checked, invalid records dropped and counted, never cast.
 */

import { asFiniteNumber, isRecord } from "../../lib/storage";
import { isIsoDate } from "./model";
import {
  ASSET_CLASS_LABELS,
  DEFAULT_ESSENTIAL_CATEGORIES,
  EMPTY_PROFILE,
  GOAL_KIND_LABELS,
  type ActionDecision,
  type AssetClass,
  type Budget,
  type Cadence,
  type Goal,
  type GoalKind,
  type Holding,
  type PlanningState,
  type Profile,
  type RecurringItem,
} from "./planning";

const CADENCES: ReadonlySet<string> = new Set([
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
]);

function str(v: unknown, max = 200): string | null {
  return typeof v === "string" ? v.slice(0, max) : null;
}
function cents(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}
function optCents(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  const n = cents(v);
  return n === null || n < 0 ? undefined : n;
}
function optDate(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === "string" && isIsoDate(v) ? v : undefined;
}

export function parseBudget(v: unknown): Budget | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, 64);
  const category = str(v.category, 60);
  const limit = cents(v.limit_cents);
  const start = str(v.start_month, 7);
  if (
    !id ||
    !category ||
    limit === null ||
    limit <= 0 ||
    !start ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(start)
  )
    return null;
  return { id, category, limit_cents: limit, start_month: start };
}

export function parseRecurring(
  v: unknown,
  accountIds: Set<string>,
): RecurringItem | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, 64);
  const kind = v.kind;
  const amount = cents(v.amount_cents);
  const account = str(v.account_id, 64);
  const to = v.to_account_id == null ? null : str(v.to_account_id, 64);
  const cadence = str(v.cadence, 16);
  const next = str(v.next_date, 10);
  const end = optDate(v.end_date);
  if (!id || (kind !== "income" && kind !== "expense" && kind !== "transfer"))
    return null;
  if (amount === null || amount <= 0 || !account || !accountIds.has(account))
    return null;
  if (kind === "transfer" && (!to || !accountIds.has(to) || to === account))
    return null;
  if (
    !cadence ||
    !CADENCES.has(cadence) ||
    !next ||
    !isIsoDate(next) ||
    end === undefined
  )
    return null;
  return {
    id,
    description: str(v.description) ?? "",
    kind,
    amount_cents: amount,
    account_id: account,
    to_account_id: kind === "transfer" ? to : null,
    category: str(v.category, 60) || "Uncategorized",
    cadence: cadence as Cadence,
    next_date: next,
    end_date: end,
    certainty: v.certainty === "estimated" ? "estimated" : "fixed",
    essential: v.essential === true,
  };
}

export function parseGoal(v: unknown, accountIds: Set<string>): Goal | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, 64);
  const name = str(v.name, 120);
  const kind = str(v.kind, 32);
  const target = cents(v.target_cents);
  const funded = cents(v.funded_cents ?? 0);
  const date = optDate(v.target_date);
  const priority = asFiniteNumber(v.priority ?? 3);
  const contribution = optCents(v.monthly_contribution_cents);
  if (!id || !name || !kind || !(kind in GOAL_KIND_LABELS)) return null;
  if (
    target === null ||
    target <= 0 ||
    funded === null ||
    funded < 0 ||
    date === undefined
  )
    return null;
  if (
    priority === null ||
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 5
  )
    return null;
  if (contribution === undefined) return null;
  const linked = Array.isArray(v.linked_account_ids)
    ? v.linked_account_ids.filter(
        (x): x is string => typeof x === "string" && accountIds.has(x),
      )
    : [];
  return {
    id,
    name,
    kind: kind as GoalKind,
    target_cents: target,
    funded_cents: funded,
    linked_account_ids: linked,
    target_date: date,
    priority,
    monthly_contribution_cents: contribution,
    description: str(v.description, 500) ?? "",
  };
}

export function parseHolding(
  v: unknown,
  accountIds: Set<string>,
): Holding | null {
  if (!isRecord(v)) return null;
  const id = str(v.id, 64);
  const account = str(v.account_id, 64);
  const symbol = str(v.symbol, 16);
  const quantity = asFiniteNumber(v.quantity);
  const cls = str(v.asset_class, 32);
  const basis = optCents(v.cost_basis_cents);
  const price = optCents(v.price_cents);
  const priceDate = optDate(v.price_date);
  const acquired = optDate(v.acquired_date);
  if (!id || !account || !accountIds.has(account) || !symbol) return null;
  if (
    quantity === null ||
    quantity <= 0 ||
    !cls ||
    !(cls in ASSET_CLASS_LABELS)
  )
    return null;
  if (
    basis === undefined ||
    price === undefined ||
    priceDate === undefined ||
    acquired === undefined
  )
    return null;
  if (price !== null && priceDate === null) return null; // a price must say when it applied
  return {
    id,
    account_id: account,
    symbol: symbol.toUpperCase(),
    name: str(v.name, 120) ?? "",
    quantity,
    cost_basis_cents: basis,
    acquired_date: acquired,
    price_cents: price,
    price_date: priceDate,
    asset_class: cls as AssetClass,
    sector: str(v.sector, 60) ?? "",
  };
}

export function parseProfile(v: unknown): Profile {
  if (!isRecord(v)) return { ...EMPTY_PROFILE };
  const risk = v.risk_tolerance;
  const horizon = asFiniteNumber(v.horizon_years);
  const months = asFiniteNumber(v.emergency_months_target);
  const exp = v.experience;
  return {
    risk_tolerance:
      risk === "low" || risk === "medium" || risk === "high" ? risk : null,
    horizon_years:
      horizon !== null && horizon >= 0 && horizon <= 80 ? horizon : null,
    emergency_months_target:
      months !== null && months >= 0 && months <= 36 ? months : null,
    excluded_sectors: Array.isArray(v.excluded_sectors)
      ? v.excluded_sectors
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.slice(0, 60))
      : [],
    experience:
      exp === "new" || exp === "some" || exp === "experienced" ? exp : null,
  };
}

function parseDecision(v: unknown): ActionDecision | null {
  if (!isRecord(v)) return null;
  const status = v.status;
  const until = optDate(v.until);
  const on = str(v.decided_on, 10);
  if (
    (status !== "done" && status !== "dismissed" && status !== "deferred") ||
    until === undefined
  )
    return null;
  if (!on || !isIsoDate(on)) return null;
  return {
    status,
    until: status === "deferred" ? until : null,
    decided_on: on,
  };
}

function list<T>(
  raw: unknown,
  parse: (v: unknown) => T | null,
): { items: T[]; dropped: number } {
  if (!Array.isArray(raw)) return { items: [], dropped: 0 };
  const items = raw.map(parse).filter((x): x is T => x !== null);
  return { items, dropped: raw.length - items.length };
}

export function parsePlanning(
  raw: unknown,
  accountIds: Set<string>,
): { planning: PlanningState; dropped: number } {
  const doc = isRecord(raw) ? raw : {};
  const budgets = list(doc.budgets, parseBudget);
  const recurring = list(doc.recurring, (v) => parseRecurring(v, accountIds));
  const goals = list(doc.goals, (v) => parseGoal(v, accountIds));
  const holdings = list(doc.holdings, (v) => parseHolding(v, accountIds));
  const decisions: Record<string, ActionDecision> = {};
  if (isRecord(doc.action_decisions)) {
    for (const [key, value] of Object.entries(doc.action_decisions).slice(
      0,
      2000,
    )) {
      const d = parseDecision(value);
      if (d && key.length <= 200) decisions[key] = d;
    }
  }
  const essential = Array.isArray(doc.essential_categories)
    ? [
        ...new Set(
          doc.essential_categories
            .filter((c): c is string => typeof c === "string")
            .map((c) => c.slice(0, 60)),
        ),
      ]
    : [...DEFAULT_ESSENTIAL_CATEGORIES];
  return {
    planning: {
      budgets: budgets.items,
      recurring: recurring.items,
      goals: goals.items,
      holdings: holdings.items,
      profile: parseProfile(doc.profile),
      essential_categories: essential,
      action_decisions: decisions,
    },
    dropped:
      budgets.dropped + recurring.dropped + goals.dropped + holdings.dropped,
  };
}
