/**
 * Schema v2 planning entities: budgets, recurring items, goals, holdings, the
 * optional profile, and the user's decisions on suggested actions. Same rules as
 * model.ts: integer cents, null (never 0) for anything not provided, local only.
 *
 * This file is the contract the feature modules build on. Change it only with a
 * schema migration in store.ts.
 */

export type Cadence =
  "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface Budget {
  id: string;
  category: string;
  /** Monthly limit. */
  limit_cents: number;
  /** First month the budget applies, YYYY-MM. */
  start_month: string;
}

export interface RecurringItem {
  id: string;
  description: string;
  kind: "income" | "expense" | "transfer";
  amount_cents: number; // positive
  account_id: string;
  to_account_id: string | null; // transfers only
  category: string;
  cadence: Cadence;
  /** Next date it is due, YYYY-MM-DD. */
  next_date: string;
  end_date: string | null;
  /** "fixed": amount known; "estimated": varies (utilities, irregular income). */
  certainty: "fixed" | "estimated";
  /** Needed to live (rent, utilities, insurance), as opposed to discretionary. */
  essential: boolean;
}

export type GoalKind =
  | "emergency_fund"
  | "purchase"
  | "debt_payoff"
  | "education"
  | "home"
  | "investing"
  | "net_worth"
  | "custom";

export interface Goal {
  id: string;
  name: string;
  kind: GoalKind;
  target_cents: number;
  /** Amount already set aside, entered by the user. Ignored when accounts are linked. */
  funded_cents: number;
  /** Accounts whose balances count as the funded amount. Empty = use funded_cents. */
  linked_account_ids: string[];
  target_date: string | null;
  /** 1 (highest) to 5. */
  priority: number;
  /** What the user plans to put toward it each month. Null = not decided. */
  monthly_contribution_cents: number | null;
  description: string;
}

export type AssetClass =
  | "us_stock"
  | "intl_stock"
  | "bond"
  | "cash_equivalent"
  | "real_estate"
  | "commodity"
  | "crypto"
  | "other";

export interface Holding {
  id: string;
  /** The brokerage or retirement account it is held in. */
  account_id: string;
  symbol: string;
  name: string;
  quantity: number; // shares/units, may be fractional
  /** Total cost paid for the position. Null = unknown. */
  cost_basis_cents: number | null;
  acquired_date: string | null;
  /** Price per unit the user entered, and the date it applies to. Never a synthetic price. */
  price_cents: number | null;
  price_date: string | null;
  asset_class: AssetClass;
  /** Sector or industry label the user chose, for concentration checks. */
  sector: string;
}

export interface Profile {
  risk_tolerance: "low" | "medium" | "high" | null;
  horizon_years: number | null;
  /** Months of essential spending the user wants in reserve. Null = not set. */
  emergency_months_target: number | null;
  excluded_sectors: string[];
  experience: "new" | "some" | "experienced" | null;
}

export interface ActionDecision {
  status: "done" | "dismissed" | "deferred";
  /** Deferred only: hide until this date. */
  until: string | null;
  decided_on: string;
}

export interface PlanningState {
  budgets: Budget[];
  recurring: RecurringItem[];
  goals: Goal[];
  holdings: Holding[];
  profile: Profile;
  /** Categories the user marks as essential spending. */
  essential_categories: string[];
  /** Keyed by a stable action id produced by the action engine. */
  action_decisions: Record<string, ActionDecision>;
}

export const EMPTY_PROFILE: Profile = {
  risk_tolerance: null,
  horizon_years: null,
  emergency_months_target: null,
  excluded_sectors: [],
  experience: null,
};

export const DEFAULT_ESSENTIAL_CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Insurance",
  "Health",
  "Transportation",
];

export const EMPTY_PLANNING: PlanningState = {
  budgets: [],
  recurring: [],
  goals: [],
  holdings: [],
  profile: EMPTY_PROFILE,
  essential_categories: [...DEFAULT_ESSENTIAL_CATEGORIES],
  action_decisions: {},
};

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  us_stock: "U.S. stocks",
  intl_stock: "International stocks",
  bond: "Bonds",
  cash_equivalent: "Cash equivalents",
  real_estate: "Real estate",
  commodity: "Commodities",
  crypto: "Crypto",
  other: "Other",
};

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  emergency_fund: "Emergency fund",
  purchase: "A purchase",
  debt_payoff: "Pay off debt",
  education: "Education",
  home: "A home",
  investing: "Long-term investing",
  net_worth: "Net worth target",
  custom: "Other goal",
};
