import { describe, expect, it } from "vitest";

import { account, SAMPLE, TODAY, tx } from "../finley/finleyFixture";
import { applyDecisions, buildActions, HIGH_INTEREST_APR } from "./actions";
import type { MoneyState } from "./model";
import type { Holding, RecurringItem } from "./planning";

const ids = (s: MoneyState) => buildActions(s, TODAY).map((a) => a.id);
const find = (s: MoneyState, id: string) =>
  buildActions(s, TODAY).find((a) => a.id === id);

const withPlanning = (patch: Partial<MoneyState["planning"]>): MoneyState => ({
  ...SAMPLE,
  planning: { ...SAMPLE.planning, ...patch },
});

const rent: RecurringItem = {
  id: "r1",
  description: "Rent",
  kind: "expense",
  amount_cents: 800_000,
  account_id: "Checking",
  to_account_id: null,
  category: "Housing",
  cadence: "monthly",
  next_date: "2026-11-01",
  end_date: null,
  certainty: "fixed",
  essential: true,
};

function holding(id: string, extra: Partial<Holding>): Holding {
  return {
    id,
    account_id: "Brokerage",
    symbol: id,
    name: id,
    quantity: 10,
    cost_basis_cents: null,
    acquired_date: null,
    price_cents: null,
    price_date: null,
    asset_class: "us_stock",
    sector: "Technology",
    ...extra,
  };
}

describe("buildActions", () => {
  it("returns nothing without an account to compute from", () => {
    expect(buildActions({ ...SAMPLE, accounts: [] }, TODAY)).toEqual([]);
  });

  it("orders by priority, then rule, then title", () => {
    expect(ids(SAMPLE)).toEqual([
      "high_interest:Card",
      "missing:debt:Loan",
      "missing:reserve_target",
    ]);
  });

  it("high-interest debt: monthly interest and the effect of $100, by hand", () => {
    // $1,000 at 24%: 1,000 x 0.24 / 12 = $20.00 a month; $100 x 0.24 / 12 = $2.00.
    const a = find(SAMPLE, "high_interest:Card")!;
    expect(a.priority).toBe(2);
    expect(a.figures).toContainEqual({
      label: "Interest a month (estimate)",
      value: "$20.00",
      note: "balance × APR ÷ 12",
    });
    expect(a.impact).toBe(
      "Each $100 paid off lowers the interest by about $2.00 a month at this rate.",
    );
    expect(a.reason).toContain(`${HIGH_INTEREST_APR}% APR or more`);
    expect(a.link.href).toBe("#/money/debts");
  });

  it("a debt below the threshold is not listed", () => {
    const low: MoneyState = {
      ...SAMPLE,
      accounts: SAMPLE.accounts.map((a) =>
        a.id === "Card" ? { ...a, apr: HIGH_INTEREST_APR - 0.5 } : a,
      ),
    };
    expect(ids(low)).not.toContain("high_interest:Card");
  });

  it("a debt without APR or minimum asks for them instead of assuming zero", () => {
    const a = find(SAMPLE, "missing:debt:Loan")!;
    expect(a.title).toMatch(
      /^Loan: add its interest rate.* and minimum payment$/,
    );
    expect(a.link.href).toBe("#/money/accounts");
  });

  it("reserve: below a large target, nothing for a small one", () => {
    const profile = SAMPLE.planning.profile;
    const big = withPlanning({
      profile: { ...profile, emergency_months_target: 24 },
    });
    const a = find(big, "reserve")!;
    expect(a.figures[0]).toEqual({
      label: "Liquid funds (settled)",
      value: "$7,500.00",
    });
    expect(ids(big)).not.toContain("missing:reserve_target");
    const small = withPlanning({
      profile: { ...profile, emergency_months_target: 1 },
    });
    expect(ids(small)).not.toContain("reserve");
  });

  it("reserve: with no essential category, asks for them", () => {
    const s = withPlanning({
      profile: { ...SAMPLE.planning.profile, emergency_months_target: 3 },
      essential_categories: [],
    });
    expect(ids(s)).toContain("missing:essential_categories");
  });

  it("shortfall: first and time-sensitive, sized from the lowest projected point", () => {
    // $7,500 liquid; $8,000 rent on Nov 1, Dec 1, Jan 1 -> lowest -$16,500 on Jan 1.
    const s = withPlanning({ recurring: [rent] });
    const [first] = buildActions(s, TODAY);
    expect(first.id).toBe("shortfall:2026-11-01");
    expect(first.priority).toBe(1);
    expect(first.impact).toMatch(
      /^An extra \$16,500\.00 in liquid accounts before 2026-11-01 would keep/,
    );
    expect(first.reason).toMatch(/not set up as recurring is not included/);
  });

  it("budget over its limit this month, keyed by month", () => {
    const s: MoneyState = {
      ...withPlanning({
        budgets: [
          {
            id: "b1",
            category: "Groceries",
            limit_cents: 10_000,
            start_month: "2026-01",
          },
        ],
      }),
      transactions: [
        ...SAMPLE.transactions,
        tx("o1", "expense", 45_000, "2026-10-03", "Groceries"),
      ],
    };
    const a = find(s, "budget:Groceries:2026-10")!;
    expect(a.figures).toContainEqual({ label: "Over by", value: "$350.00" });
  });

  it("goal that cannot fit, with its shortfall", () => {
    const s = withPlanning({
      goals: [
        {
          id: "g1",
          name: "House",
          kind: "purchase",
          target_cents: 60_000_000,
          funded_cents: 0,
          linked_account_ids: [],
          target_date: "2027-10-24",
          priority: 1,
          monthly_contribution_cents: null,
          description: "",
        },
      ],
    });
    const a = find(s, "goal:g1")!;
    expect(a.figures[0]).toEqual({
      label: "Needs a month",
      value: "$50,000.00",
    });
    expect(a.link.href).toBe("#/money/goals");
  });

  it("holdings: concentration described, unpriced and stale prices named", () => {
    const s: MoneyState = {
      ...SAMPLE,
      accounts: [...SAMPLE.accounts, account("Brokerage", "brokerage", 0)],
      planning: {
        ...SAMPLE.planning,
        holdings: [
          holding("AAA", { price_cents: 10_000, price_date: "2026-01-02" }),
          holding("BBB", {}),
        ],
      },
    };
    const found = ids(s);
    expect(found).toContain("concentration:single:AAA");
    expect(found).toContain("missing:holding_prices");
    expect(found).toContain("missing:stale_prices");
    const c = find(s, "concentration:single:AAA")!;
    expect(c.reason).toMatch(/not advice to buy or sell/);
    expect(c.impact).toBeNull();
  });

  it("subscription candidates with their monthly total", () => {
    const s: MoneyState = {
      ...SAMPLE,
      transactions: [
        ...SAMPLE.transactions,
        ...["07", "08", "09"].map((m, i) =>
          tx(`s${i}`, "expense", 1_599, `2026-${m}-15`, "Subscriptions", {
            description: "StreamCo",
          }),
        ),
      ],
    };
    expect(find(s, "subscriptions")?.impact).toBe(
      "Together about $15.99 a month at their typical amounts.",
    );
  });
});

describe("applyDecisions", () => {
  const items = buildActions(SAMPLE, TODAY);
  const [card, loan, reserve] = items;

  it("splits by decision; a deferral ends on its date", () => {
    const list = applyDecisions(
      items,
      {
        [card.id]: { status: "done", until: null, decided_on: TODAY },
        [loan.id]: {
          status: "deferred",
          until: "2026-11-23",
          decided_on: TODAY,
        },
        [reserve.id]: { status: "dismissed", until: null, decided_on: TODAY },
      },
      TODAY,
    );
    expect(list.done).toEqual([card]);
    expect(list.deferred).toEqual([{ item: loan, until: "2026-11-23" }]);
    expect(list.dismissed).toEqual([reserve]);
    expect(list.active).toEqual([]);

    const later = applyDecisions(
      items,
      {
        [loan.id]: {
          status: "deferred",
          until: "2026-11-23",
          decided_on: TODAY,
        },
      },
      "2026-11-23",
    );
    expect(later.active.map((a) => a.id)).toContain(loan.id);
  });
});
