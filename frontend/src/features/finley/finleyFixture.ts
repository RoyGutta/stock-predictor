/** Shared test fixture for Finley: small enough to check every figure by hand. */
import { EMPTY_PLANNING } from "../money/planning";
import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "../money/model";

export const TODAY = "2026-10-24";

export function account(
  id: string,
  type: Account["type"],
  opening: number,
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

export function tx(
  id: string,
  kind: Transaction["kind"],
  amount: number,
  date: string,
  category: string,
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    date,
    kind,
    amount_cents: amount,
    account_id: "Checking",
    to_account_id: null,
    interest_cents: 0,
    category,
    splits: [],
    description: "",
    notes: "",
    status: "settled",
    ...extra,
  };
}

/**
 * Checking opens at $5,000; September 2026 has $4,000 income and $1,500 spending
 * ($1,200 Housing, $300 Groceries), so checking holds $7,500. A card owes $1,000
 * at 24% APR with a $30 minimum; a loan owes $500 with no APR recorded.
 * Net worth $6,000. One complete month with records: savings rate 62.5%, and
 * cash covers 5.0 months of spending.
 */
export const SAMPLE: MoneyState = {
  ...EMPTY_STATE,
  accounts: [
    account("Checking", "checking", 500_000),
    account("Card", "credit_card", 100_000, {
      apr: 24,
      minimum_payment_cents: 3_000,
    }),
    account("Loan", "personal_loan", 50_000),
  ],
  transactions: [
    tx("t1", "income", 400_000, "2026-09-05", "Salary"),
    tx("t2", "expense", 120_000, "2026-09-10", "Housing"),
    tx("t3", "expense", 30_000, "2026-09-12", "Groceries"),
  ],
  planning: structuredClone(EMPTY_PLANNING),
};
