/** Test fixtures shared by the goals and forecast tests. Not used by the app. */

import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "../features/money/model";
import {
  EMPTY_PLANNING,
  type Goal,
  type RecurringItem,
} from "../features/money/planning";

export function account(
  id: string,
  type: Account["type"],
  opening = 0,
  extra: Partial<Account> = {},
): Account {
  return {
    id,
    name: id,
    type,
    currency: "USD",
    institution: "",
    notes: "",
    opening_balance_cents: opening,
    opening_date: "2026-01-01",
    apr: null,
    minimum_payment_cents: null,
    planned_payment_cents: null,
    due_day: null,
    archived: false,
    ...extra,
  };
}

let seq = 0;
export function tx(
  kind: Transaction["kind"],
  amount: number,
  account_id: string,
  date: string,
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    kind,
    amount_cents: amount,
    account_id,
    to_account_id: null,
    interest_cents: 0,
    category: "Uncategorized",
    splits: [],
    description: "",
    notes: "",
    status: "settled",
    ...extra,
  };
}

export function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    name: id,
    kind: "custom",
    target_cents: 100_000,
    funded_cents: 0,
    linked_account_ids: [],
    target_date: null,
    priority: 3,
    monthly_contribution_cents: null,
    description: "",
    ...extra,
  };
}

export function recurring(
  id: string,
  extra: Partial<RecurringItem> = {},
): RecurringItem {
  return {
    id,
    description: id,
    kind: "expense",
    amount_cents: 10_000,
    account_id: "checking",
    to_account_id: null,
    category: "Uncategorized",
    cadence: "monthly",
    next_date: "2026-11-01",
    end_date: null,
    certainty: "fixed",
    essential: false,
    ...extra,
  };
}

export function makeState(
  accounts: Account[],
  transactions: Transaction[] = [],
  planning: Partial<MoneyState["planning"]> = {},
): MoneyState {
  return {
    ...EMPTY_STATE,
    accounts,
    transactions,
    planning: { ...EMPTY_PLANNING, ...planning },
  };
}
