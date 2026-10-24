// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BackupError, createBackup, openBackup } from "./backup";
import { EMPTY_STATE, type MoneyState } from "./model";

// Real Web Crypto (Node's implementation). A lower iteration count keeps the
// suite fast; the production default of 600,000 is asserted separately.
const FAST = { iterations: 100_000 };
const PASS = "correct horse battery staple";

const STATE: MoneyState = {
  ...EMPTY_STATE,
  accounts: [
    {
      id: "a1",
      name: "Checking",
      type: "checking",
      currency: "USD",
      institution: "",
      notes: "",
      opening_balance_cents: 123_456,
      opening_date: "2026-01-01",
      apr: null,
      minimum_payment_cents: null,
      planned_payment_cents: null,
      due_day: null,
      archived: false,
    },
  ],
};

describe("encrypted backup", () => {
  it("round-trips exactly with the right passphrase", async () => {
    const file = await createBackup(STATE, PASS, FAST);
    const opened = await openBackup(file, PASS);
    expect(opened.state).toEqual(STATE);
    expect(opened.dropped).toBe(0);
  });

  it("contains no plaintext financial data", async () => {
    const file = await createBackup(STATE, PASS, FAST);
    expect(file).not.toContain("Checking");
    expect(file).not.toContain("123456");
  });

  it("uses 600,000 PBKDF2 iterations by default", async () => {
    const file = await createBackup(STATE, PASS);
    expect(JSON.parse(file).kdf.iterations).toBe(600_000);
  }, 20_000);

  it("rejects a wrong passphrase without returning anything", async () => {
    const file = await createBackup(STATE, PASS, FAST);
    await expect(openBackup(file, "not the passphrase")).rejects.toThrow(
      /Wrong passphrase/,
    );
  });

  it("detects a tampered ciphertext", async () => {
    const env = JSON.parse(await createBackup(STATE, PASS, FAST));
    const bytes = atob(env.ciphertext).split("");
    bytes[5] = String.fromCharCode(bytes[5].charCodeAt(0) ^ 1);
    env.ciphertext = btoa(bytes.join(""));
    await expect(openBackup(JSON.stringify(env), PASS)).rejects.toThrow(
      /altered/,
    );
  });

  it("detects a tampered header, which is authenticated too", async () => {
    const env = JSON.parse(await createBackup(STATE, PASS, FAST));
    env.kdf.iterations = 100_001;
    await expect(openBackup(JSON.stringify(env), PASS)).rejects.toThrow(
      /altered/,
    );
  });

  it.each([
    ["not JSON", "hello"],
    ["another file", JSON.stringify({ format: "something-else" })],
    [
      "future version",
      JSON.stringify({ format: "stock-predictor-money-backup", version: 9 }),
    ],
    [
      "missing fields",
      JSON.stringify({ format: "stock-predictor-money-backup", version: 1 }),
    ],
  ])("refuses %s with a clear message", async (_label, text) => {
    await expect(openBackup(text, PASS)).rejects.toBeInstanceOf(BackupError);
  });

  it("refuses a short passphrase", async () => {
    await expect(createBackup(STATE, "short")).rejects.toThrow(
      /at least 10 characters/,
    );
  });

  it("refuses contents that decrypt but fail validation", async () => {
    const bogus = { ...STATE, schema_version: 0 } as unknown as MoneyState;
    const file = await createBackup(bogus, PASS, FAST);
    await expect(openBackup(file, PASS)).rejects.toThrow(
      /incompatible version or are invalid/,
    );
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = JSON.parse(await createBackup(STATE, PASS, FAST));
    const b = JSON.parse(await createBackup(STATE, PASS, FAST));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
  });
});
