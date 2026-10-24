/**
 * The ledger engine: pure, deterministic, local. Every figure the Money Manager
 * shows is computed here from the user's own records, and every rule below is a
 * test in ledger.test.ts.
 *
 * - Balance(account, asOf) = opening balance + effects of transactions dated on
 *   or after the opening date and on or before `asOf`. Transactions dated before
 *   the opening date are already inside the opening balance, so they count in
 *   income and spending reports but not in the balance (and are flagged).
 * - A transfer between the user's own accounts conserves net worth, except for
 *   any interest portion of a payment to a debt, which is spending.
 * - Spending = expenses + interest paid - refunds. Income = income transactions.
 *   Transfers and valuations are neither.
 * - Totals include USD accounts only; other currencies are listed as excluded.
 * - Missing inputs give null, never 0: no APR means no interest estimate.
 */

import {
  ACCOUNT_TYPES,
  isLiability,
  type Account,
  type AccountType,
  type MoneyState,
  type Transaction,
} from "./model";

export interface Effect {
  account_id: string;
  delta: number; // cents, natural sign
}

/** How one transaction changes each account's natural balance. */
export function effectsOf(
  tx: Transaction,
  accounts: Map<string, Account>,
): Effect[] {
  const from = accounts.get(tx.account_id);
  if (!from) return [];
  const sign = (account: Account, assetDelta: number) =>
    isLiability(account) ? -assetDelta : assetDelta;
  switch (tx.kind) {
    case "income":
    case "refund":
      return [{ account_id: from.id, delta: sign(from, tx.amount_cents) }];
    case "expense":
      return [{ account_id: from.id, delta: sign(from, -tx.amount_cents) }];
    case "valuation":
      return [{ account_id: from.id, delta: tx.amount_cents }];
    case "transfer": {
      const to = tx.to_account_id ? accounts.get(tx.to_account_id) : undefined;
      if (!to) return [];
      const interest = isLiability(to) ? tx.interest_cents : 0;
      return [
        { account_id: from.id, delta: sign(from, -tx.amount_cents) },
        { account_id: to.id, delta: sign(to, tx.amount_cents - interest) },
      ];
    }
  }
}

export interface BalanceOptions {
  includePending?: boolean;
}

export function balances(
  state: MoneyState,
  asOf: string,
  { includePending = false }: BalanceOptions = {},
): Map<string, number> {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const out = new Map<string, number>();
  for (const a of state.accounts) {
    out.set(a.id, a.opening_date <= asOf ? a.opening_balance_cents : 0);
  }
  for (const tx of state.transactions) {
    if (tx.date > asOf) continue;
    if (tx.status === "pending" && !includePending) continue;
    for (const effect of effectsOf(tx, byId)) {
      const account = byId.get(effect.account_id);
      if (!account || tx.date < account.opening_date) continue;
      out.set(
        effect.account_id,
        (out.get(effect.account_id) ?? 0) + effect.delta,
      );
    }
  }
  return out;
}

export interface Position {
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  liquid_assets: number;
  by_type: Partial<Record<AccountType, number>>;
  excluded_currency_accounts: string[];
  pending_count: number;
}

export function position(state: MoneyState, asOf: string): Position {
  const settled = balances(state, asOf);
  let assets = 0;
  let liabilities = 0;
  let liquid = 0;
  const byType: Partial<Record<AccountType, number>> = {};
  const excluded: string[] = [];
  for (const a of state.accounts) {
    if (a.archived) continue;
    if (a.currency !== "USD") {
      excluded.push(a.name);
      continue;
    }
    const balance = settled.get(a.id) ?? 0;
    byType[a.type] = (byType[a.type] ?? 0) + balance;
    if (isLiability(a)) {
      liabilities += balance;
    } else {
      assets += balance;
      if (ACCOUNT_TYPES[a.type].liquid) liquid += balance;
    }
  }
  return {
    total_assets: assets,
    total_liabilities: liabilities,
    net_worth: assets - liabilities,
    liquid_assets: liquid,
    by_type: byType,
    excluded_currency_accounts: excluded,
    pending_count: state.transactions.filter(
      (t) => t.status === "pending" && t.date <= asOf,
    ).length,
  };
}

// --- income and spending -----------------------------------------------------------

export interface Flows {
  income: number;
  spending: number;
  net: number; // income - spending
  /** (income - spending) / income; null without income. */
  savings_rate: number | null;
  by_category: Record<string, number>; // spending by category, refunds netted
  income_by_category: Record<string, number>;
  interest_paid: number;
  transfers: number; // volume, for information only
}

function allocations(
  tx: Transaction,
): { category: string; amount_cents: number }[] {
  return tx.splits.length > 0
    ? tx.splits
    : [{ category: tx.category, amount_cents: tx.amount_cents }];
}

/** Settled flows dated within [start, end] inclusive, USD accounts only. */
export function flows(state: MoneyState, start: string, end: string): Flows {
  const out: Flows = {
    income: 0,
    spending: 0,
    net: 0,
    savings_rate: null,
    by_category: {},
    income_by_category: {},
    interest_paid: 0,
    transfers: 0,
  };
  const usd = new Set(
    state.accounts.filter((a) => a.currency === "USD").map((a) => a.id),
  );
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const add = (bucket: Record<string, number>, key: string, cents: number) => {
    bucket[key] = (bucket[key] ?? 0) + cents;
  };
  for (const tx of state.transactions) {
    if (tx.status !== "settled" || tx.date < start || tx.date > end) continue;
    if (!usd.has(tx.account_id)) continue;
    switch (tx.kind) {
      case "income":
        out.income += tx.amount_cents;
        for (const a of allocations(tx))
          add(out.income_by_category, a.category, a.amount_cents);
        break;
      case "expense":
        out.spending += tx.amount_cents;
        for (const a of allocations(tx))
          add(out.by_category, a.category, a.amount_cents);
        break;
      case "refund":
        out.spending -= tx.amount_cents;
        for (const a of allocations(tx))
          add(out.by_category, a.category, -a.amount_cents);
        break;
      case "transfer": {
        out.transfers += tx.amount_cents;
        const to = tx.to_account_id ? byId.get(tx.to_account_id) : undefined;
        if (to && isLiability(to) && tx.interest_cents > 0) {
          out.spending += tx.interest_cents;
          out.interest_paid += tx.interest_cents;
          add(out.by_category, "Interest", tx.interest_cents);
        }
        break;
      }
      case "valuation":
        break;
    }
  }
  out.net = out.income - out.spending;
  out.savings_rate = out.income > 0 ? out.net / out.income : null;
  return out;
}

export interface MonthFlows extends Flows {
  month: string; // YYYY-MM
  start: string;
  end: string;
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The `count` complete calendar months before the month containing `asOf`, oldest first. */
export function completeMonths(
  state: MoneyState,
  asOf: string,
  count: number,
): MonthFlows[] {
  const out: MonthFlows[] = [];
  let month = previousMonth(asOf.slice(0, 7));
  for (let i = 0; i < count; i++) {
    const { start, end } = monthBounds(month);
    out.unshift({ ...flows(state, start, end), month, start, end });
    month = previousMonth(month);
  }
  return out;
}

// --- debt ----------------------------------------------------------------------------

export interface PayoffResult {
  feasible: boolean;
  months: number | null;
  total_interest_cents: number | null;
  reason: string | null;
}

const MAX_MONTHS = 600;

/**
 * Month-by-month amortization: each month interest = balance x APR / 12 (rounded
 * to the cent) is added, then the payment is applied. A payment that does not
 * exceed the first month's interest never pays the debt off and is reported as
 * infeasible. A simplification, stated in the UI: cards compound daily and loan
 * servicers may apply payments on different dates.
 */
export function payoff(
  balanceCents: number,
  aprPercent: number | null,
  paymentCents: number | null,
): PayoffResult {
  if (balanceCents <= 0) {
    return { feasible: true, months: 0, total_interest_cents: 0, reason: null };
  }
  if (aprPercent == null) {
    return {
      feasible: false,
      months: null,
      total_interest_cents: null,
      reason: "No interest rate is recorded for this debt.",
    };
  }
  if (paymentCents == null || paymentCents <= 0) {
    return {
      feasible: false,
      months: null,
      total_interest_cents: null,
      reason: "No monthly payment is recorded for this debt.",
    };
  }
  const rate = aprPercent / 100 / 12;
  let balance = balanceCents;
  let interestTotal = 0;
  for (let month = 1; month <= MAX_MONTHS; month++) {
    const interest = Math.round(balance * rate);
    if (month === 1 && paymentCents <= interest) {
      return {
        feasible: false,
        months: null,
        total_interest_cents: null,
        reason:
          "The payment does not cover the monthly interest, so the balance would not fall.",
      };
    }
    interestTotal += interest;
    balance = balance + interest - paymentCents;
    if (balance <= 0) {
      return {
        feasible: true,
        months: month,
        total_interest_cents: interestTotal,
        reason: null,
      };
    }
  }
  return {
    feasible: false,
    months: null,
    total_interest_cents: null,
    reason: "Not paid off within 50 years at this payment.",
  };
}

export interface DebtRow {
  account: Account;
  balance_cents: number;
  monthly_interest_cents: number | null;
  payment_cents: number | null; // planned if given, else minimum
  payment_basis: "planned" | "minimum" | null;
  payoff: PayoffResult;
  missing: string[];
}

export function debts(state: MoneyState, asOf: string): DebtRow[] {
  const settled = balances(state, asOf);
  return state.accounts
    .filter((a) => isLiability(a) && !a.archived && a.currency === "USD")
    .map((a) => {
      const balance = settled.get(a.id) ?? 0;
      const payment = a.planned_payment_cents ?? a.minimum_payment_cents;
      const missing: string[] = [];
      if (a.apr == null) missing.push("interest rate");
      if (a.minimum_payment_cents == null) missing.push("minimum payment");
      return {
        account: a,
        balance_cents: balance,
        monthly_interest_cents:
          a.apr == null
            ? null
            : Math.round(Math.max(balance, 0) * (a.apr / 100 / 12)),
        payment_cents: payment,
        payment_basis:
          a.planned_payment_cents != null
            ? "planned"
            : a.minimum_payment_cents != null
              ? "minimum"
              : null,
        payoff: payoff(balance, a.apr, payment),
        missing,
      };
    });
}

export interface Ratios {
  /** Total liabilities / total assets. Null when there are no assets. */
  debt_to_assets: number | null;
  /** Recorded minimum payments / average monthly income (last 3 complete months). */
  debt_payment_to_income: number | null;
  /** Liquid assets / average monthly spending (last 3 complete months). */
  months_of_spending_covered: number | null;
  average_monthly_income: number | null;
  average_monthly_spending: number | null;
  months_used: number;
  debts_missing_minimum: number;
}

export function ratios(state: MoneyState, asOf: string): Ratios {
  const pos = position(state, asOf);
  const months = completeMonths(state, asOf, 3).filter(
    (m) => m.income > 0 || m.spending > 0,
  );
  const average = (pick: (m: MonthFlows) => number) =>
    months.length
      ? months.reduce((s, m) => s + pick(m), 0) / months.length
      : null;
  const avgIncome = average((m) => m.income);
  const avgSpending = average((m) => m.spending);
  const liabilities = debts(state, asOf);
  const known = liabilities.filter(
    (d) => d.account.minimum_payment_cents != null,
  );
  const minimums = known.reduce(
    (s, d) => s + (d.account.minimum_payment_cents ?? 0),
    0,
  );
  return {
    debt_to_assets:
      pos.total_assets > 0 ? pos.total_liabilities / pos.total_assets : null,
    debt_payment_to_income:
      avgIncome && avgIncome > 0 && known.length > 0
        ? minimums / avgIncome
        : null,
    months_of_spending_covered:
      avgSpending && avgSpending > 0 ? pos.liquid_assets / avgSpending : null,
    average_monthly_income: avgIncome,
    average_monthly_spending: avgSpending,
    months_used: months.length,
    debts_missing_minimum: liabilities.length - known.length,
  };
}

// --- integrity --------------------------------------------------------------------

/** Problems with a transaction in the context of the user's accounts. Empty = valid. */
export function validateTransaction(
  tx: Transaction,
  accounts: Account[],
): string[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const problems: string[] = [];
  const from = byId.get(tx.account_id);
  if (!from) problems.push("Choose an account.");
  if (tx.kind === "valuation") {
    if (!Number.isSafeInteger(tx.amount_cents) || tx.amount_cents === 0) {
      problems.push("Enter a non-zero change in value.");
    }
  } else if (!Number.isSafeInteger(tx.amount_cents) || tx.amount_cents <= 0) {
    problems.push("Enter an amount greater than zero.");
  }
  if (tx.kind === "transfer") {
    const to = tx.to_account_id ? byId.get(tx.to_account_id) : undefined;
    if (!to) problems.push("Choose the account receiving the transfer.");
    else if (to.id === tx.account_id)
      problems.push("A transfer needs two different accounts.");
    else if (from && to.currency !== from.currency) {
      problems.push("Transfers between currencies are not supported yet.");
    }
    if (tx.interest_cents < 0 || tx.interest_cents > tx.amount_cents) {
      problems.push("Interest must be between zero and the payment amount.");
    }
    if (tx.interest_cents > 0 && to && !isLiability(to)) {
      problems.push("Only a payment to a debt can include interest.");
    }
  } else if (tx.interest_cents !== 0) {
    problems.push("Interest applies only to payments to a debt.");
  }
  if (tx.splits.length > 0) {
    const sum = tx.splits.reduce((s, x) => s + x.amount_cents, 0);
    if (sum !== Math.abs(tx.amount_cents))
      problems.push("Split amounts must add up to the total.");
    if (tx.splits.some((x) => x.amount_cents <= 0))
      problems.push("Each split needs a positive amount.");
  }
  if (from && tx.date < from.opening_date) {
    problems.push(
      `This is dated before ${from.name}'s opening balance date, so it will not change that balance.`,
    );
  }
  return problems;
}

export interface Reconciliation {
  computed_cents: number;
  statement_cents: number;
  difference_cents: number; // statement - computed
}

export function reconcile(
  state: MoneyState,
  accountId: string,
  asOf: string,
  statementCents: number,
): Reconciliation {
  const computed = balances(state, asOf).get(accountId) ?? 0;
  return {
    computed_cents: computed,
    statement_cents: statementCents,
    difference_cents: statementCents - computed,
  };
}
