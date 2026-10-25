/** Test fixtures for budgets, recurring items, and BudgetsView. Not used by the app. */

import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";
import {
  EMPTY_PLANNING,
  type PlanningState,
  type RecurringItem,
} from "./planning";

export function account(id: string, extra: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type: "checking",
    currency: "USD",
    institution: "",
    notes: "",
    opening_balance_cents: 100_000,
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
  date: string,
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    date,
    kind,
    amount_cents: amount,
    account_id: "chk",
    to_account_id: null,
    interest_cents: 0,
    category: "Groceries",
    splits: [],
    description: "",
    notes: "",
    status: "settled",
    ...extra,
  };
}

export function recurring(extra: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: "r1",
    description: "Rent",
    kind: "expense",
    amount_cents: 150_000,
    account_id: "chk",
    to_account_id: null,
    category: "Housing",
    cadence: "monthly",
    next_date: "2026-03-01",
    end_date: null,
    certainty: "fixed",
    essential: true,
    ...extra,
  };
}

export function stateWith(
  transactions: Transaction[],
  accounts: Account[] = [account("chk")],
  planning: Partial<PlanningState> = {},
): MoneyState {
  return {
    ...EMPTY_STATE,
    accounts,
    transactions,
    planning: { ...EMPTY_PLANNING, ...planning },
  };
}
