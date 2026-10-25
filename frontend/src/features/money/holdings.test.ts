import { describe, expect, it } from "vitest";

import {
  compareToMix,
  concentration,
  daysBetween,
  portfolio,
  reconcileAccounts,
  REFERENCE_MIXES,
  validateMix,
  valueHolding,
} from "./holdings";
import { EMPTY_STATE, type Account, type MoneyState } from "./model";
import { EMPTY_PROFILE, type Holding } from "./planning";

const AS_OF = "2026-10-24";

function holding(over: Partial<Holding> = {}): Holding {
  return {
    id: over.id ?? `h-${Math.random()}`,
    account_id: "brk",
    symbol: "AAA",
    name: "Alpha",
    quantity: 10,
    cost_basis_cents: null,
    acquired_date: null,
    price_cents: 10_000,
    price_date: AS_OF,
    asset_class: "us_stock",
    sector: "Technology",
    ...over,
  };
}

function account(over: Partial<Account> = {}): Account {
  return {
    id: "brk",
    name: "Brokerage",
    type: "brokerage",
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
    ...over,
  };
}

function stateWith(
  holdings: Holding[],
  accounts: Account[] = [account()],
): MoneyState {
  return {
    ...EMPTY_STATE,
    accounts,
    planning: { ...EMPTY_STATE.planning, holdings },
  };
}

describe("valueHolding", () => {
  it("values only with an entered price and its date", () => {
    expect(valueHolding(holding(), AS_OF).value_cents).toBe(100_000);
    const noPrice = valueHolding(holding({ price_cents: null }), AS_OF);
    expect(noPrice.value_cents).toBeNull();
    expect(noPrice.value_missing).toBe("Needs a price");
    const noDate = valueHolding(holding({ price_date: null }), AS_OF);
    expect(noDate.value_cents).toBeNull();
    expect(noDate.value_missing).toMatch(/date/);
    expect(noDate.price_age_days).toBeNull();
    expect(noDate.stale).toBe(false);
  });

  it("rounds fractional quantities to the cent", () => {
    // 0.333 x $100.01 = $33.30333 -> $33.30
    expect(
      valueHolding(holding({ quantity: 0.333, price_cents: 10_001 }), AS_OF)
        .value_cents,
    ).toBe(3330);
    // 1.5 x $0.33 = $0.495 -> $0.50 (half rounds up)
    expect(
      valueHolding(holding({ quantity: 1.5, price_cents: 33 }), AS_OF)
        .value_cents,
    ).toBe(50);
    expect(
      Number.isInteger(
        valueHolding(holding({ quantity: 0.1 }), AS_OF).value_cents,
      ),
    ).toBe(true);
  });

  it("computes gain only when value and cost basis both exist", () => {
    const r = valueHolding(holding({ cost_basis_cents: 80_000 }), AS_OF);
    expect(r.gain_cents).toBe(20_000);
    const loss = valueHolding(holding({ cost_basis_cents: 120_000 }), AS_OF);
    expect(loss.gain_cents).toBe(-20_000);
    const noBasis = valueHolding(holding(), AS_OF);
    expect(noBasis.gain_cents).toBeNull();
    expect(noBasis.gain_missing).toMatch(/Cost basis/);
    const noValue = valueHolding(
      holding({ price_cents: null, cost_basis_cents: 5 }),
      AS_OF,
    );
    expect(noValue.gain_cents).toBeNull();
  });

  it("flags prices older than 31 days, not at exactly 31", () => {
    expect(daysBetween("2026-09-23", AS_OF)).toBe(31);
    const at31 = valueHolding(holding({ price_date: "2026-09-23" }), AS_OF);
    expect(at31.price_age_days).toBe(31);
    expect(at31.stale).toBe(false);
    const at32 = valueHolding(holding({ price_date: "2026-09-22" }), AS_OF);
    expect(at32.price_age_days).toBe(32);
    expect(at32.stale).toBe(true);
  });
});

describe("reconcileAccounts", () => {
  it("reports the difference between the ledger balance and valued holdings", () => {
    const state = stateWith(
      [holding({ quantity: 10 }), holding({ price_cents: null, id: "x" })],
      [
        account({ opening_balance_cents: 150_000 }),
        account({ id: "empty", name: "Other" }),
      ],
    );
    const p = portfolio(state, AS_OF);
    const checks = reconcileAccounts(state, p.rows, AS_OF);
    expect(checks).toHaveLength(1); // the account with no holdings is not listed
    expect(checks[0]).toMatchObject({
      ledger_balance_cents: 150_000,
      valued_holdings_cents: 100_000,
      valued_count: 1,
      unvalued_count: 1,
      difference_cents: 50_000,
    });
  });

  it("does not force a match when holdings exceed the balance", () => {
    const state = stateWith(
      [holding()],
      [account({ opening_balance_cents: 90_000 })],
    );
    const [check] = reconcileAccounts(
      state,
      portfolio(state, AS_OF).rows,
      AS_OF,
    );
    expect(check.difference_cents).toBe(-10_000);
  });
});

describe("portfolio allocation", () => {
  it("uses valued holdings only and reports the unvalued share", () => {
    const state = stateWith([
      holding({ id: "a", quantity: 30 }), // $3,000 stock
      holding({
        id: "b",
        symbol: "BND",
        asset_class: "bond",
        sector: "Bonds",
        quantity: 10,
      }), // $1,000
      holding({
        id: "c",
        symbol: "ZZZ",
        price_cents: null,
        cost_basis_cents: 77_700,
      }),
      holding({ id: "d", symbol: "YYY", price_date: null }),
    ]);
    const p = portfolio(state, AS_OF);
    expect(p.total_valued_cents).toBe(400_000);
    expect(p.valued_count).toBe(2);
    expect(p.unvalued_count).toBe(2);
    expect(p.unvalued_pct_of_count).toBe(50);
    expect(p.unvalued_cost_basis_cents).toBe(77_700);
    expect(p.by_class.map((s) => [s.key, s.pct])).toEqual([
      ["us_stock", 75],
      ["bond", 25],
    ]);
    expect(p.by_sector.map((s) => s.label)).toEqual(["Technology", "Bonds"]);
  });

  it("keeps non-dollar and orphaned holdings out of totals, with a reason", () => {
    const state = stateWith(
      [
        holding({ id: "a" }),
        holding({ id: "e", account_id: "eur" }),
        holding({ id: "o", account_id: "gone" }),
      ],
      [account(), account({ id: "eur", currency: "EUR" })],
    );
    const p = portfolio(state, AS_OF);
    expect(p.total_valued_cents).toBe(100_000);
    expect(p.excluded.map((e) => e.holding.id)).toEqual(["e", "o"]);
    expect(p.excluded[0].reason).toMatch(/EUR/);
  });
});

describe("concentration", () => {
  it("flags a single position above 20%, not at exactly 20%", () => {
    const at20 = stateWith([
      holding({ id: "a", symbol: "A", quantity: 20, sector: "S1" }),
      ...["B", "C", "D", "E"].map((s, i) =>
        holding({ id: s, symbol: s, quantity: 20, sector: `S${i + 2}` }),
      ),
    ]);
    const c20 = concentration(portfolio(at20, AS_OF), EMPTY_PROFILE);
    expect(c20.largest?.pct).toBe(20);
    expect(c20.single_flag).toBe(false);
    expect(c20.top3_pct).toBe(60);

    const over = stateWith([
      holding({ id: "a", symbol: "A", quantity: 21, sector: "S1" }),
      holding({ id: "b", symbol: "B", quantity: 79, sector: "S2" }),
    ]);
    const c = concentration(portfolio(over, AS_OF), EMPTY_PROFILE);
    expect(c.largest?.label).toBe("B");
    expect(c.single_flag).toBe(true);
    expect(c.findings[0]).toMatch(/79\.0%.*20%.*concentration to review/);
  });

  it("combines the same symbol held in two accounts", () => {
    const state = stateWith(
      [
        holding({ id: "1", symbol: "aaa", quantity: 10 }),
        holding({ id: "2", account_id: "ira", symbol: "AAA", quantity: 10 }),
        holding({ id: "3", symbol: "BBB", quantity: 30, sector: "Health" }),
      ],
      [account(), account({ id: "ira", type: "retirement" })],
    );
    const c = concentration(portfolio(state, AS_OF), EMPTY_PROFILE);
    expect(c.largest).toMatchObject({ label: "BBB", pct: 60 });
  });

  it("flags a sector above 35%, not at exactly 35%", () => {
    const at35 = stateWith([
      holding({ id: "a", symbol: "A", quantity: 35, sector: "Energy" }),
      ...["B", "C", "D", "E"].map((s, i) =>
        holding({
          id: s,
          symbol: s,
          quantity: i === 0 ? 5 : 20,
          sector: `Other${i}`,
        }),
      ),
    ]);
    const c35 = concentration(portfolio(at35, AS_OF), EMPTY_PROFILE);
    expect(c35.largest_sector).toMatchObject({ label: "Energy", pct: 35 });
    expect(c35.sector_flag).toBe(false);

    const at36 = stateWith([
      holding({ id: "a", symbol: "A", quantity: 18, sector: "Energy" }),
      holding({ id: "b", symbol: "B", quantity: 18, sector: "energy " }),
      holding({ id: "c", symbol: "C", quantity: 64, sector: "Mixed" }),
    ]);
    const c = concentration(portfolio(at36, AS_OF), EMPTY_PROFILE);
    expect(c.sector_flag).toBe(true);
  });

  it("lists holdings in sectors the profile excludes, case-insensitively", () => {
    const state = stateWith([
      holding({ id: "t", symbol: "TOB", sector: "Tobacco", price_cents: null }),
      holding({ id: "ok", symbol: "OK", sector: "Utilities" }),
    ]);
    const c = concentration(portfolio(state, AS_OF), {
      ...EMPTY_PROFILE,
      excluded_sectors: ["tobacco"],
    });
    expect(c.in_excluded_sectors.map((h) => h.id)).toEqual(["t"]);
    expect(c.findings.some((f) => f.includes("TOB"))).toBe(true);
  });

  it("reports nothing when no holding is valued", () => {
    const state = stateWith([holding({ price_cents: null })]);
    const c = concentration(portfolio(state, AS_OF), EMPTY_PROFILE);
    expect(c.largest).toBeNull();
    expect(c.top3_pct).toBeNull();
    expect(c.single_flag).toBe(false);
  });
});

describe("reference mixes", () => {
  it("presets each sum to 100", () => {
    for (const m of REFERENCE_MIXES) expect(validateMix(m.weights)).toEqual([]);
  });

  it("a custom mix must sum to 100 with whole numbers 0-100", () => {
    expect(validateMix({ stocks: 70, bond: 20 })[0]).toMatch(/add up to 90%/);
    expect(validateMix({ stocks: 70, bond: 30 })).toEqual([]);
    expect(validateMix({ stocks: 110, bond: -10 }).length).toBeGreaterThan(0);
    expect(validateMix({ stocks: 50.5, bond: 49.5 }).length).toBeGreaterThan(0);
  });

  it("reports differences in percentage points, stocks combined", () => {
    const state = stateWith([
      holding({ id: "u", quantity: 50 }), // $5,000 U.S.
      holding({
        id: "i",
        symbol: "INT",
        asset_class: "intl_stock",
        quantity: 20,
      }), // $2,000
      holding({ id: "b", symbol: "BND", asset_class: "bond", quantity: 20 }), // $2,000
      holding({
        id: "c",
        symbol: "CSH",
        asset_class: "cash_equivalent",
        quantity: 10,
      }), // $1,000
    ]);
    const rows = compareToMix(portfolio(state, AS_OF), {
      stocks: 60,
      bond: 40,
    });
    expect(
      rows?.map((r) => [
        r.bucket,
        r.actual_pct,
        r.reference_pct,
        r.difference_pp,
      ]),
    ).toEqual([
      ["stocks", 70, 60, 10],
      ["bond", 20, 40, -20],
      ["cash_equivalent", 10, 0, 10],
    ]);
  });

  it("returns null when nothing is valued", () => {
    const state = stateWith([holding({ price_cents: null })]);
    expect(compareToMix(portfolio(state, AS_OF), { stocks: 100 })).toBeNull();
  });
});
