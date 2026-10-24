import { describe, expect, it } from "vitest";

import {
  balances,
  completeMonths,
  debts,
  flows,
  payoff,
  position,
  ratios,
  reconcile,
  validateTransaction,
} from "./ledger";
import {
  EMPTY_STATE,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";

function account(
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
function tx(
  kind: Transaction["kind"],
  amount: number,
  account_id: string,
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    date: "2026-03-10",
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

function state(accounts: Account[], transactions: Transaction[]): MoneyState {
  return { ...EMPTY_STATE, accounts, transactions };
}

const CHECKING = account("checking", "checking", 100_000); // $1,000.00
const CARD = account("card", "credit_card", 20_000, {
  apr: 24,
  minimum_payment_cents: 3_500,
});
const BROKERAGE = account("brokerage", "brokerage", 500_000);
const LOAN = account("loan", "student_loan", 1_000_000, {
  apr: 6,
  minimum_payment_cents: 11_102,
});

describe("opening balances", () => {
  it("are balances, not income", () => {
    const s = state([CHECKING, CARD], []);
    expect(balances(s, "2026-03-31").get("checking")).toBe(100_000);
    expect(flows(s, "2026-01-01", "2026-12-31").income).toBe(0);
    expect(position(s, "2026-03-31").net_worth).toBe(80_000);
  });

  it("count only from their own date", () => {
    expect(balances(state([CHECKING], []), "2025-12-31").get("checking")).toBe(
      0,
    );
  });
});

describe("sign convention", () => {
  it("income raises an asset; expense lowers it", () => {
    const s = state(
      [CHECKING],
      [tx("income", 250_000, "checking"), tx("expense", 4_250, "checking")],
    );
    expect(balances(s, "2026-03-31").get("checking")).toBe(
      100_000 + 250_000 - 4_250,
    );
    const f = flows(s, "2026-03-01", "2026-03-31");
    expect([f.income, f.spending, f.net]).toEqual([250_000, 4_250, 245_750]);
  });

  it("a card purchase raises what is owed and counts as spending once", () => {
    const s = state(
      [CHECKING, CARD],
      [
        tx("expense", 6_000, "card", { category: "Dining" }),
        tx("transfer", 6_000, "checking", {
          to_account_id: "card",
          date: "2026-03-20",
        }),
      ],
    );
    const b = balances(s, "2026-03-31");
    expect(b.get("card")).toBe(20_000); // charged $60 then paid $60
    expect(b.get("checking")).toBe(94_000);
    const f = flows(s, "2026-03-01", "2026-03-31");
    expect(f.spending).toBe(6_000); // the card payment is not spending again
    expect(f.by_category).toEqual({ Dining: 6_000 });
  });

  it("a refund reverses spending in its category", () => {
    const s = state(
      [CARD],
      [
        tx("expense", 10_000, "card", { category: "Shopping" }),
        tx("refund", 2_500, "card", { category: "Shopping" }),
      ],
    );
    expect(balances(s, "2026-03-31").get("card")).toBe(20_000 + 7_500);
    expect(flows(s, "2026-03-01", "2026-03-31").by_category.Shopping).toBe(
      7_500,
    );
  });

  it("buying an asset is a transfer, not an expense", () => {
    const s = state(
      [CHECKING, BROKERAGE],
      [tx("transfer", 50_000, "checking", { to_account_id: "brokerage" })],
    );
    expect(position(s, "2026-03-31").net_worth).toBe(100_000 + 500_000);
    expect(flows(s, "2026-03-01", "2026-03-31").spending).toBe(0);
  });

  it("a loan payment splits principal from interest", () => {
    const before = position(
      state([CHECKING, LOAN], []),
      "2026-03-31",
    ).net_worth;
    const s = state(
      [CHECKING, LOAN],
      [
        tx("transfer", 11_102, "checking", {
          to_account_id: "loan",
          interest_cents: 5_000,
        }),
      ],
    );
    const b = balances(s, "2026-03-31");
    expect(b.get("loan")).toBe(1_000_000 - 6_102); // only principal reduces the debt
    expect(b.get("checking")).toBe(100_000 - 11_102);
    const f = flows(s, "2026-03-01", "2026-03-31");
    expect([f.spending, f.interest_paid, f.by_category.Interest]).toEqual([
      5_000, 5_000, 5_000,
    ]);
    expect(position(s, "2026-03-31").net_worth).toBe(before - 5_000); // falls by the interest
  });

  it("a valuation changes value but is never income or spending", () => {
    const s = state([BROKERAGE], [tx("valuation", -12_345, "brokerage")]);
    expect(balances(s, "2026-03-31").get("brokerage")).toBe(500_000 - 12_345);
    const f = flows(s, "2026-01-01", "2026-12-31");
    expect([f.income, f.spending]).toEqual([0, 0]);
  });

  it("splits allocate one transaction across categories", () => {
    const s = state(
      [CHECKING],
      [
        tx("expense", 10_000, "checking", {
          splits: [
            { category: "Groceries", amount_cents: 7_000 },
            { category: "Health", amount_cents: 3_000 },
          ],
        }),
      ],
    );
    expect(flows(s, "2026-03-01", "2026-03-31").by_category).toEqual({
      Groceries: 7_000,
      Health: 3_000,
    });
  });
});

describe("invariants", () => {
  it("any transfer without interest conserves net worth (200 random cases)", () => {
    const accounts = [
      CHECKING,
      CARD,
      BROKERAGE,
      LOAN,
      account("savings", "savings", 30_000),
    ];
    const base = position(state(accounts, []), "2026-12-31").net_worth;
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const from = accounts[Math.floor(rand() * accounts.length)];
      let to = accounts[Math.floor(rand() * accounts.length)];
      if (to.id === from.id)
        to = accounts[(accounts.indexOf(from) + 1) % accounts.length];
      const amount = 1 + Math.floor(rand() * 1_000_000);
      const s = state(accounts, [
        tx("transfer", amount, from.id, { to_account_id: to.id }),
      ]);
      expect(position(s, "2026-12-31").net_worth).toBe(base);
      expect(flows(s, "2026-01-01", "2026-12-31").spending).toBe(0);
    }
  });

  it("pending items stay out of balances and flows until settled", () => {
    const s = state(
      [CHECKING],
      [tx("expense", 5_000, "checking", { status: "pending" })],
    );
    expect(balances(s, "2026-03-31").get("checking")).toBe(100_000);
    expect(
      balances(s, "2026-03-31", { includePending: true }).get("checking"),
    ).toBe(95_000);
    expect(flows(s, "2026-03-01", "2026-03-31").spending).toBe(0);
    expect(position(s, "2026-03-31").pending_count).toBe(1);
  });

  it("transactions before the opening date do not move the balance and are flagged", () => {
    const early = tx("expense", 5_000, "checking", { date: "2025-12-15" });
    const s = state([CHECKING], [early]);
    expect(balances(s, "2026-03-31").get("checking")).toBe(100_000);
    expect(validateTransaction(early, [CHECKING]).join(" ")).toMatch(
      /before checking's opening balance date/,
    );
  });

  it("future-dated transactions are excluded from earlier balances", () => {
    const s = state(
      [CHECKING],
      [tx("income", 1_000, "checking", { date: "2026-04-02" })],
    );
    expect(balances(s, "2026-04-01").get("checking")).toBe(100_000);
    expect(balances(s, "2026-04-02").get("checking")).toBe(101_000);
  });

  it("non-USD accounts stay out of totals and are named", () => {
    const eur = account("eur", "savings", 50_000, {
      currency: "EUR",
      name: "Euro savings",
    });
    const p = position(state([CHECKING, eur], []), "2026-03-31");
    expect(p.total_assets).toBe(100_000);
    expect(p.excluded_currency_accounts).toEqual(["Euro savings"]);
  });

  it("archived accounts leave totals", () => {
    expect(
      position(state([{ ...CHECKING, archived: true }], []), "2026-03-31")
        .total_assets,
    ).toBe(0);
  });
});

describe("months and ratios", () => {
  it("uses complete calendar months only, with real month-end boundaries", () => {
    const s = state(
      [CHECKING],
      [
        tx("income", 300_000, "checking", { date: "2026-02-28" }),
        tx("expense", 100_000, "checking", { date: "2026-03-01" }),
        tx("expense", 999, "checking", { date: "2026-04-05" }), // current month: excluded
      ],
    );
    const months = completeMonths(s, "2026-04-10", 3);
    expect(months.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(months[1].income).toBe(300_000);
    expect(months[2].spending).toBe(100_000);
    expect(months[1].end).toBe("2026-02-28");
  });

  it("savings rate is null without income, never a division by zero", () => {
    expect(
      flows(
        state([CHECKING], [tx("expense", 1_000, "checking")]),
        "2026-03-01",
        "2026-03-31",
      ).savings_rate,
    ).toBeNull();
  });

  it("ratios are null when their inputs are missing", () => {
    const r = ratios(state([CARD], []), "2026-04-10");
    expect(r.debt_to_assets).toBeNull();
    expect(r.debt_payment_to_income).toBeNull();
    expect(r.months_of_spending_covered).toBeNull();
  });

  it("debt-to-income and months covered use the stated averages", () => {
    const s = state(
      [CHECKING, CARD],
      [
        tx("income", 400_000, "checking", { date: "2026-03-05" }),
        tx("expense", 200_000, "checking", { date: "2026-03-06" }),
      ],
    );
    const r = ratios(s, "2026-04-10");
    expect(r.months_used).toBe(1);
    expect(r.debt_payment_to_income).toBeCloseTo(3_500 / 400_000);
    expect(r.months_of_spending_covered).toBeCloseTo(
      (100_000 + 200_000) / 200_000,
    );
  });
});

describe("debt payoff", () => {
  it("matches the standard amortization known answer", () => {
    // $10,000 at 6% APR: the exact level payment for 120 months is $111.0205.
    // Paying $111.03 clears it in 120 months with about $3,322 of interest.
    const result = payoff(1_000_000, 6, 11_103);
    expect(result.feasible).toBe(true);
    expect(result.months).toBe(120);
    expect(result.total_interest_cents!).toBeGreaterThan(332_000);
    expect(result.total_interest_cents!).toBeLessThan(333_000);
    // Paying $111.02, a fraction of a cent short each month, leaves a few cents
    // for a 121st payment: the engine reports that rather than rounding it away.
    expect(payoff(1_000_000, 6, 11_102).months).toBe(121);
  });

  it("is infeasible when the payment does not cover interest", () => {
    const result = payoff(1_000_000, 24, 20_000); // interest is $200 a month
    expect(result.feasible).toBe(false);
    expect(result.reason).toMatch(/does not cover the monthly interest/);
  });

  it("never assumes a missing rate or payment", () => {
    expect(payoff(100_000, null, 10_000).reason).toMatch(/No interest rate/);
    expect(payoff(100_000, 5, null).reason).toMatch(/No monthly payment/);
  });

  it("an extra payment shortens payoff and lowers interest", () => {
    const base = payoff(500_000, 18, 15_000);
    const extra = payoff(500_000, 18, 20_000);
    expect(extra.months!).toBeLessThan(base.months!);
    expect(extra.total_interest_cents!).toBeLessThan(
      base.total_interest_cents!,
    );
  });

  it("a stated zero APR is honoured", () => {
    expect(payoff(100_000, 0, 10_000)).toMatchObject({
      months: 10,
      total_interest_cents: 0,
    });
  });

  it("debt rows flag missing inputs and estimate interest only with an APR", () => {
    const noRate = account("auto", "auto_loan", 1_500_000);
    const rows = debts(state([CARD, noRate], []), "2026-03-31");
    expect(rows[0].monthly_interest_cents).toBe(400); // $200 x 24% / 12
    expect(rows[1].monthly_interest_cents).toBeNull();
    expect(rows[1].missing).toEqual(["interest rate", "minimum payment"]);
  });
});

describe("validation and reconciliation", () => {
  const accounts = [CHECKING, BROKERAGE, CARD];

  it.each([
    [tx("expense", 0, "checking"), "Enter an amount greater than zero."],
    [
      tx("transfer", 100, "checking", { to_account_id: "checking" }),
      "A transfer needs two different accounts.",
    ],
    [
      tx("transfer", 100, "checking", {
        to_account_id: "brokerage",
        interest_cents: 10,
      }),
      "Only a payment to a debt can include interest.",
    ],
    [
      tx("transfer", 100, "checking", {
        to_account_id: "card",
        interest_cents: 200,
      }),
      "Interest must be between zero and the payment amount.",
    ],
    [
      tx("expense", 100, "checking", {
        splits: [{ category: "A", amount_cents: 60 }],
      }),
      "Split amounts must add up to the total.",
    ],
    [tx("valuation", 0, "brokerage"), "Enter a non-zero change in value."],
    [tx("expense", 100, "missing"), "Choose an account."],
  ])("rejects %#", (transaction, message) => {
    expect(validateTransaction(transaction, accounts)).toContain(message);
  });

  it("accepts a well-formed transaction", () => {
    expect(
      validateTransaction(tx("expense", 100, "checking"), accounts),
    ).toEqual([]);
  });

  it("reconciliation reports the difference to a statement", () => {
    const s = state([CHECKING], [tx("expense", 2_000, "checking")]);
    expect(reconcile(s, "checking", "2026-03-31", 97_500)).toEqual({
      computed_cents: 98_000,
      statement_cents: 97_500,
      difference_cents: -500,
    });
  });

  it("editing or deleting a transaction recomputes from the records", () => {
    const t = tx("expense", 2_000, "checking");
    expect(
      balances(
        state([CHECKING], [{ ...t, amount_cents: 3_000 }]),
        "2026-03-31",
      ).get("checking"),
    ).toBe(97_000);
    expect(balances(state([CHECKING], []), "2026-03-31").get("checking")).toBe(
      100_000,
    );
  });
});
