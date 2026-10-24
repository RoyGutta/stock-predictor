/**
 * Money Manager data model. Local-first: everything here lives in the user's
 * browser and is never sent to the server.
 *
 * Conventions, used everywhere and pinned by tests:
 * - Amounts are integer cents. No floating-point money.
 * - Account balances are "natural": an asset's balance is what the user holds,
 *   a liability's balance is what the user owes. Both are normally >= 0.
 * - Transaction amounts are positive. The kind says what the money did:
 *     income    money in to an account (counts as income)
 *     expense   money out of an account or charged to a card (counts as spending)
 *     refund    reverses part of an earlier expense (reduces spending)
 *     transfer  between two of the user's accounts (neither income nor spending);
 *               a payment to a liability may carry `interest_cents`, the part
 *               that paid interest rather than principal (counted as spending)
 *     valuation a change in an asset's or debt's value that is not cash moving
 *               (market moves, appraisal, accrued interest); signed amount;
 *               never income or spending
 * - Only USD is aggregated. Accounts in other currencies are tracked but kept out
 *   of totals, and the totals say so.
 */

export const MONEY_SCHEMA_VERSION = 1;

export type AccountType =
  | "cash"
  | "checking"
  | "savings"
  | "money_market"
  | "cd"
  | "brokerage"
  | "retirement"
  | "real_estate"
  | "vehicle"
  | "other_asset"
  | "credit_card"
  | "student_loan"
  | "auto_loan"
  | "mortgage"
  | "personal_loan"
  | "other_liability";

export interface AccountTypeInfo {
  label: string;
  side: "asset" | "liability";
  /** Can be spent within days without penalty. CDs and investments are not. */
  liquid: boolean;
}

export const ACCOUNT_TYPES: Record<AccountType, AccountTypeInfo> = {
  cash: { label: "Cash", side: "asset", liquid: true },
  checking: { label: "Checking", side: "asset", liquid: true },
  savings: { label: "Savings", side: "asset", liquid: true },
  money_market: { label: "Money market", side: "asset", liquid: true },
  cd: { label: "Certificate of deposit", side: "asset", liquid: false },
  brokerage: { label: "Brokerage", side: "asset", liquid: false },
  retirement: { label: "Retirement", side: "asset", liquid: false },
  real_estate: { label: "Real estate", side: "asset", liquid: false },
  vehicle: { label: "Vehicle", side: "asset", liquid: false },
  other_asset: { label: "Other asset", side: "asset", liquid: false },
  credit_card: { label: "Credit card", side: "liability", liquid: false },
  student_loan: { label: "Student loan", side: "liability", liquid: false },
  auto_loan: { label: "Auto loan", side: "liability", liquid: false },
  mortgage: { label: "Mortgage", side: "liability", liquid: false },
  personal_loan: { label: "Personal loan", side: "liability", liquid: false },
  other_liability: { label: "Other debt", side: "liability", liquid: false },
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string; // ISO 4217; only "USD" enters totals
  institution: string;
  notes: string;
  /** Balance on `opening_date`, natural sign. Not income. */
  opening_balance_cents: number;
  opening_date: string; // YYYY-MM-DD
  /** Liabilities: annual percentage rate in percent, e.g. 24.99. Null = not provided. */
  apr: number | null;
  /** Liabilities: required minimum monthly payment. Null = not provided. */
  minimum_payment_cents: number | null;
  /** Liabilities: what the user normally pays each month. Null = not provided. */
  planned_payment_cents: number | null;
  /** Day of month a payment is due, 1-31. Null = not provided. */
  due_day: number | null;
  archived: boolean;
}

export type TransactionKind =
  "income" | "expense" | "refund" | "transfer" | "valuation";

export interface Split {
  category: string;
  amount_cents: number;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  kind: TransactionKind;
  /** Positive, except `valuation`, where it is a signed change in natural balance. */
  amount_cents: number;
  account_id: string;
  /** Transfers only: the receiving account. */
  to_account_id: string | null;
  /** Transfers to a liability only: the part that paid interest, not principal. */
  interest_cents: number;
  category: string;
  splits: Split[];
  description: string;
  notes: string;
  status: "settled" | "pending";
}

export interface MoneyState {
  schema_version: number;
  accounts: Account[];
  transactions: Transaction[];
  categories: string[];
}

export const DEFAULT_CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Dining",
  "Transportation",
  "Insurance",
  "Health",
  "Subscriptions",
  "Shopping",
  "Entertainment",
  "Travel",
  "Education",
  "Gifts",
  "Interest",
  "Fees",
  "Taxes",
  "Salary",
  "Other income",
  "Uncategorized",
];

export const EMPTY_STATE: MoneyState = {
  schema_version: MONEY_SCHEMA_VERSION,
  accounts: [],
  transactions: [],
  categories: [...DEFAULT_CATEGORIES],
};

export function isLiability(account: Pick<Account, "type">): boolean {
  return ACCOUNT_TYPES[account.type].side === "liability";
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

// --- money parsing and formatting -------------------------------------------

const MAX_CENTS = 1e13; // $100 billion: anything larger is a typo, not a balance

/**
 * Parse user-entered money ("1,234.56", "$75", "-12.5") to integer cents.
 * Returns null for anything that is not a plain amount; never guesses.
 */
export function parseMoney(
  input: string,
  { allowNegative = false } = {},
): number | null {
  const text = input
    .trim()
    .replace(/^(-?)\$/, "$1")
    .replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  if (negative && !allowNegative) return null;
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

export function formatCents(
  cents: number | null | undefined,
  currency = "USD",
): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const value = cents / 100;
  try {
    return value.toLocaleString("en-US", { style: "currency", currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Today's calendar date in the user's time zone, YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** How each kind is described in forms. */
export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: "Expense (money out, or a card charge)",
  income: "Income (money in)",
  refund: "Refund (money back for an earlier expense)",
  transfer: "Transfer between your accounts (including debt payments)",
  valuation: "Value change (investment, property, or accrued interest)",
};
