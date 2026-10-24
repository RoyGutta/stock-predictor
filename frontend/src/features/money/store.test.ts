import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_STATE, MONEY_SCHEMA_VERSION, type MoneyState } from "./model";
import {
  PRE_RESTORE_KEY,
  QUARANTINE_KEY,
  STORAGE_KEY,
  clearMoney,
  hasQuarantine,
  loadMoney,
  migrate,
  parseState,
  readPreRestore,
  saveMoney,
  snapshotBeforeRestore,
} from "./store";

const ACCOUNT = {
  id: "a1",
  name: "Checking",
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
};
const TX = {
  id: "t1",
  date: "2026-02-01",
  kind: "expense",
  amount_cents: 1_500,
  account_id: "a1",
  to_account_id: null,
  interest_cents: 0,
  category: "Dining",
  splits: [],
  description: "Lunch",
  notes: "",
  status: "settled",
};

function doc(extra: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: 1,
    accounts: [ACCOUNT],
    transactions: [TX],
    categories: ["Dining"],
    ...extra,
  };
}

beforeEach(() => localStorage.clear());

describe("validated reads", () => {
  it("round-trips a valid document", () => {
    const parsed = parseState(doc());
    expect(parsed?.dropped).toBe(0);
    expect(parsed?.state.transactions[0].amount_cents).toBe(1_500);
  });

  it.each([
    ["non-integer cents", { ...TX, amount_cents: 15.5 }],
    ["negative amount", { ...TX, amount_cents: -5 }],
    ["unknown kind", { ...TX, kind: "gift" }],
    ["impossible date", { ...TX, date: "2026-02-30" }],
    ["orphan account", { ...TX, account_id: "missing" }],
    ["transfer without destination", { ...TX, kind: "transfer" }],
    ["bad split", { ...TX, splits: [{ category: "A", amount_cents: 0 }] }],
  ])("drops a transaction with %s and counts it", (_label, bad) => {
    const parsed = parseState(doc({ transactions: [TX, bad] }));
    expect(parsed?.state.transactions).toHaveLength(1);
    expect(parsed?.dropped).toBe(1);
  });

  it.each([
    ["unknown type", { ...ACCOUNT, type: "crypto_wallet" }],
    ["APR above 100", { ...ACCOUNT, apr: 250 }],
    ["lower-case currency", { ...ACCOUNT, currency: "usd" }],
    ["due day 32", { ...ACCOUNT, due_day: 32 }],
    ["string balance", { ...ACCOUNT, opening_balance_cents: "1000" }],
  ])("drops an account with %s", (_label, bad) => {
    expect(
      parseState(doc({ accounts: [bad], transactions: [] }))?.state.accounts,
    ).toHaveLength(0);
  });

  it("truncates oversized text instead of storing it", () => {
    const long = { ...TX, description: "x".repeat(10_000) };
    expect(
      parseState(doc({ transactions: [long] }))?.state.transactions[0]
        .description,
    ).toHaveLength(500);
  });

  it("keeps untrusted text as inert data", () => {
    const script = { ...TX, description: '<img src=x onerror="alert(1)">' };
    expect(
      parseState(doc({ transactions: [script] }))?.state.transactions[0]
        .description,
    ).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("storage and recovery", () => {
  it("saves and loads", () => {
    const state = parseState(doc())!.state;
    expect(saveMoney(state)).toBe(true);
    expect(loadMoney().state).toEqual(state);
  });

  it("quarantines corrupt data instead of deleting it", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const result = loadMoney();
    expect(result.quarantined).toBe(true);
    expect(result.state.accounts).toEqual([]);
    expect(localStorage.getItem(QUARANTINE_KEY)).toBe("{not json");
    expect(hasQuarantine()).toBe(true);
  });

  it("leaves data from a newer version untouched and does not load it", () => {
    const newer = JSON.stringify(
      doc({ schema_version: MONEY_SCHEMA_VERSION + 1 }),
    );
    localStorage.setItem(STORAGE_KEY, newer);
    const result = loadMoney();
    expect(result.newer_version).toBe(MONEY_SCHEMA_VERSION + 1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(newer);
  });

  it("keeps a pre-restore snapshot that can be read back", () => {
    const state = parseState(doc())!.state;
    saveMoney(state);
    snapshotBeforeRestore();
    saveMoney(EMPTY_STATE as MoneyState);
    expect(readPreRestore()).toEqual(state);
    expect(localStorage.getItem(PRE_RESTORE_KEY)).not.toBeNull();
  });

  it("clear-all removes every Money Manager key and nothing else", () => {
    localStorage.setItem("stock-predictor:watchlist:v1", "[]");
    saveMoney(parseState(doc())!.state);
    localStorage.setItem(QUARANTINE_KEY, "x");
    snapshotBeforeRestore();
    clearMoney();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull();
    expect(localStorage.getItem(PRE_RESTORE_KEY)).toBeNull();
    expect(localStorage.getItem("stock-predictor:watchlist:v1")).toBe("[]");
  });
});

describe("migrations", () => {
  it("applies each step in order up to the target version", () => {
    const steps = {
      1: (d: Record<string, unknown>) => ({ ...d, added_in_2: true }),
      2: (d: Record<string, unknown>) => ({ ...d, added_in_3: true }),
    };
    expect(migrate({ schema_version: 1 }, steps, 3)).toEqual({
      schema_version: 3,
      added_in_2: true,
      added_in_3: true,
    });
  });

  it("refuses a gap in the migration chain or an invalid version", () => {
    expect(migrate({ schema_version: 1 }, {}, 2)).toBeNull();
    expect(migrate({ schema_version: 0 })).toBeNull();
    expect(migrate({ schema_version: "1" })).toBeNull();
    expect(migrate({ schema_version: 99 })).toBeNull();
  });
});
