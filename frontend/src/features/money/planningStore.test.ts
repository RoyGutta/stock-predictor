import { describe, expect, it } from "vitest";

import { MONEY_SCHEMA_VERSION } from "./model";
import { EMPTY_PLANNING } from "./planning";
import {
  parseBudget,
  parseGoal,
  parseHolding,
  parsePlanning,
  parseRecurring,
} from "./planningStore";
import { parseState } from "./store";

const IDS = new Set(["a1", "a2"]);
const ACCOUNT = {
  id: "a1",
  name: "Checking",
  type: "checking",
  currency: "USD",
  institution: "",
  notes: "",
  opening_balance_cents: 0,
  opening_date: "2026-01-01",
  apr: null,
  minimum_payment_cents: null,
  planned_payment_cents: null,
  due_day: null,
  archived: false,
};

describe("schema v2 migration", () => {
  it("upgrades a v1 document with an empty planning section and keeps everything else", () => {
    const parsed = parseState({
      schema_version: 1,
      accounts: [ACCOUNT],
      transactions: [],
      categories: ["A"],
    });
    expect(MONEY_SCHEMA_VERSION).toBe(2);
    expect(parsed?.state.schema_version).toBe(2);
    expect(parsed?.state.accounts).toHaveLength(1);
    expect(parsed?.state.planning).toEqual(EMPTY_PLANNING);
  });

  it("drops planning records pointing at missing accounts and counts them", () => {
    const parsed = parseState({
      schema_version: 2,
      accounts: [ACCOUNT],
      transactions: [],
      categories: [],
      planning: {
        holdings: [
          {
            id: "h",
            account_id: "gone",
            symbol: "VTI",
            quantity: 1,
            asset_class: "us_stock",
          },
        ],
      },
    });
    expect(parsed?.state.planning.holdings).toEqual([]);
    expect(parsed?.dropped).toBe(1);
  });
});

describe("planning validators", () => {
  it("budgets need a positive limit and a real month", () => {
    expect(
      parseBudget({
        id: "b",
        category: "Dining",
        limit_cents: 30000,
        start_month: "2026-10",
      }),
    ).not.toBeNull();
    expect(
      parseBudget({
        id: "b",
        category: "Dining",
        limit_cents: 0,
        start_month: "2026-10",
      }),
    ).toBeNull();
    expect(
      parseBudget({
        id: "b",
        category: "Dining",
        limit_cents: 100,
        start_month: "2026-13",
      }),
    ).toBeNull();
  });

  it("recurring transfers need two distinct known accounts and a real cadence", () => {
    const base = {
      id: "r",
      kind: "transfer",
      amount_cents: 500,
      account_id: "a1",
      to_account_id: "a2",
      cadence: "monthly",
      next_date: "2026-11-01",
    };
    expect(parseRecurring(base, IDS)).not.toBeNull();
    expect(parseRecurring({ ...base, to_account_id: "a1" }, IDS)).toBeNull();
    expect(parseRecurring({ ...base, cadence: "daily" }, IDS)).toBeNull();
    expect(
      parseRecurring({ ...base, kind: "expense", to_account_id: "a2" }, IDS)
        ?.to_account_id,
    ).toBeNull();
  });

  it("goals keep an undecided contribution as null, never zero", () => {
    const goal = parseGoal(
      {
        id: "g",
        name: "Reserve",
        kind: "emergency_fund",
        target_cents: 1_000_000,
        priority: 1,
      },
      IDS,
    );
    expect(goal?.monthly_contribution_cents).toBeNull();
    expect(goal?.funded_cents).toBe(0);
    expect(
      parseGoal({ id: "g", name: "x", kind: "lottery", target_cents: 1 }, IDS),
    ).toBeNull();
    expect(
      parseGoal(
        { id: "g", name: "x", kind: "custom", target_cents: 1, priority: 9 },
        IDS,
      ),
    ).toBeNull();
  });

  it("a holding price must say when it applied", () => {
    const h = {
      id: "h",
      account_id: "a1",
      symbol: "vti",
      quantity: 2.5,
      asset_class: "us_stock",
      price_cents: 25000,
    };
    expect(parseHolding(h, IDS)).toBeNull();
    expect(parseHolding({ ...h, price_date: "2026-10-23" }, IDS)?.symbol).toBe(
      "VTI",
    );
    expect(
      parseHolding({ ...h, price_cents: null }, IDS)?.price_cents,
    ).toBeNull();
    expect(
      parseHolding({ ...h, price_date: "2026-10-23", quantity: 0 }, IDS),
    ).toBeNull();
  });

  it("an empty or malformed planning section becomes the empty defaults", () => {
    expect(parsePlanning(null, IDS).planning).toEqual(EMPTY_PLANNING);
    expect(
      parsePlanning(
        { profile: { risk_tolerance: "yolo", horizon_years: -3 } },
        IDS,
      ).planning.profile.risk_tolerance,
    ).toBeNull();
  });
});
