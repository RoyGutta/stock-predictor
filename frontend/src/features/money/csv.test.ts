import { describe, expect, it } from "vitest";

import {
  CsvError,
  defaultSignRule,
  exportTransactionsCsv,
  normalizeDate,
  parseCsv,
  previewImport,
  safeCell,
} from "./csv";
import { EMPTY_STATE, type Account, type Transaction } from "./model";

const CHECKING: Account = {
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
const CARD: Account = {
  ...CHECKING,
  id: "c1",
  name: "Card",
  type: "credit_card",
};
const MAP = { date: 0, description: 1, amount: 2, category: 3 };

describe("CSV export", () => {
  it.each(["=SUM(A1)", "+1", "-2+3", "@cmd", "\tx", "\rx"])(
    "neutralises a formula-like cell %j",
    (value) =>
      expect(safeCell(value).replace(/^"/, "").startsWith("'")).toBe(true),
  );

  it("quotes commas, quotes, and newlines; leaves numbers as numbers", () => {
    expect(safeCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(safeCell(-12.5)).toBe("-12.5");
  });

  it("exports an injected description safely", () => {
    const tx: Transaction = {
      id: "t",
      date: "2026-03-01",
      kind: "expense",
      amount_cents: 1234,
      account_id: "a1",
      to_account_id: null,
      interest_cents: 0,
      category: "Dining",
      splits: [],
      description: '=HYPERLINK("http://evil","x")',
      notes: "",
      status: "settled",
    };
    const csv = exportTransactionsCsv({
      ...EMPTY_STATE,
      accounts: [CHECKING],
      transactions: [tx],
    });
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csv).toContain("2026-03-01,expense,12.34,Checking");
  });
});

describe("CSV import", () => {
  it("parses quoted fields, escaped quotes, CRLF, and blank lines", () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'd "q"'],
      ["1", "2", "3"],
    ]);
  });

  it("rejects an unclosed quote and an oversized file", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(CsvError);
    expect(() => parseCsv("x".repeat(2_000_001))).toThrow(/larger than 2 MB/);
  });

  it.each([
    ["2026-03-05", "YYYY-MM-DD", "2026-03-05"],
    ["3/5/2026", "MM/DD/YYYY", "2026-03-05"],
    ["5/3/2026", "DD/MM/YYYY", "2026-03-05"],
    ["2/30/2026", "MM/DD/YYYY", null],
    ["2026/03/05", "YYYY-MM-DD", null],
  ] as const)("normalizes %s as %s", (value, format, expected) => {
    expect(normalizeDate(value, format)).toBe(expected);
  });

  it("previews rows with errors and duplicates, without importing", () => {
    const existing: Transaction = {
      id: "e",
      date: "2026-03-01",
      kind: "expense",
      amount_cents: 450,
      account_id: "a1",
      to_account_id: null,
      interest_cents: 0,
      category: "Dining",
      splits: [],
      description: "Coffee",
      notes: "",
      status: "settled",
    };
    const rows = parseCsv(
      "date,description,amount,category\n" +
        "2026-03-01,Coffee,-4.50,Dining\n" + // duplicate of an existing record
        "2026-03-02,Salary,2500.00,Salary\n" +
        "2026-03-02,Salary,2500.00,Salary\n" + // duplicate within the file
        "2026-13-01,Bad date,-1,\n" +
        "2026-03-03,No amount,,\n",
    );
    const preview = previewImport(
      rows,
      MAP,
      CHECKING,
      "YYYY-MM-DD",
      "negative_is_outflow",
      [existing],
    );
    expect(preview.map((p) => p.duplicate)).toEqual([
      "existing",
      null,
      "in_file",
      null,
      null,
    ]);
    expect(preview[1].transaction).toMatchObject({
      kind: "income",
      amount_cents: 250_000,
      category: "Salary",
    });
    expect(preview[3].error).toMatch(/Date/);
    expect(preview[4].error).toMatch(/Amount/);
    expect(preview[0].line).toBe(2);
  });

  it("applies the chosen sign rule, defaulting by account type", () => {
    expect(defaultSignRule(CHECKING)).toBe("negative_is_outflow");
    expect(defaultSignRule(CARD)).toBe("positive_is_outflow");
    const rows = parseCsv("d,desc,amt,cat\n2026-03-01,Shop,25.00,\n");
    const card = previewImport(
      rows,
      MAP,
      CARD,
      "YYYY-MM-DD",
      "positive_is_outflow",
      [],
    );
    expect(card[0].transaction?.kind).toBe("expense");
    const flipped = previewImport(
      rows,
      MAP,
      CARD,
      "YYYY-MM-DD",
      "negative_is_outflow",
      [],
    );
    expect(flipped[0].transaction?.kind).toBe("income");
  });
});
