import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  asArrayOf,
  asFiniteNumber,
  asString,
  isRecord,
  readStored,
  removeStored,
  storageKey,
  writeStored,
} from "./storage";

const KEY = storageKey("test");

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("storageKey", () => {
  it("namespaces and versions the key", () => {
    expect(storageKey("watchlist")).toBe("stock-predictor:watchlist:v1");
    expect(storageKey("watchlist", 2)).toBe("stock-predictor:watchlist:v2");
  });
});

describe("readStored", () => {
  const validate = (value: unknown) => asArrayOf(value, asString);

  it("returns the fallback when nothing is stored", () => {
    expect(readStored(KEY, validate, ["default"])).toEqual(["default"]);
  });

  it("round-trips a valid value", () => {
    writeStored(KEY, ["AAPL", "MSFT"]);
    expect(readStored(KEY, validate, [])).toEqual(["AAPL", "MSFT"]);
  });

  it("falls back rather than throwing on malformed JSON", () => {
    /* A truncated or hand-edited blob must not be able to crash the app. */
    localStorage.setItem(KEY, "{not json");
    expect(readStored(KEY, validate, ["safe"])).toEqual(["safe"]);
  });

  it("falls back when the stored shape fails validation", () => {
    /* An older build may have written a different shape entirely. */
    localStorage.setItem(KEY, JSON.stringify({ unexpected: "object" }));
    expect(readStored(KEY, validate, ["safe"])).toEqual(["safe"]);
  });

  it("drops individual bad entries rather than the whole list", () => {
    localStorage.setItem(KEY, JSON.stringify(["AAPL", 42, null, "MSFT"]));
    expect(readStored(KEY, validate, [])).toEqual(["AAPL", "MSFT"]);
  });

  it("falls back when storage access throws", () => {
    /* Private browsing and blocked storage both raise on getItem. */
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readStored(KEY, validate, ["safe"])).toEqual(["safe"]);
  });
});

describe("writeStored", () => {
  it("swallows a quota error so the feature keeps working", () => {
    /* Durability is a nicety; losing it must not surface as a crash. */
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStored(KEY, ["AAPL"])).not.toThrow();
  });
});

describe("removeStored", () => {
  it("clears a stored value", () => {
    writeStored(KEY, ["AAPL"]);
    removeStored(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("swallows an error from blocked storage", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => removeStored(KEY)).not.toThrow();
  });
});

describe("validators", () => {
  it.each([
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ["string", false],
    [42, false],
  ])("isRecord(%s) is %s", (value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });

  it("asString accepts only strings", () => {
    expect(asString("AAPL")).toBe("AAPL");
    expect(asString(42)).toBeNull();
    expect(asString(null)).toBeNull();
  });

  it("asFiniteNumber rejects NaN and Infinity", () => {
    /* Either would poison every downstream calculation silently. */
    expect(asFiniteNumber(1.5)).toBe(1.5);
    expect(asFiniteNumber(0)).toBe(0);
    expect(asFiniteNumber(Number.NaN)).toBeNull();
    expect(asFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(asFiniteNumber("42")).toBeNull();
  });

  it("asArrayOf rejects a non-array", () => {
    expect(asArrayOf({ nope: true }, asString)).toBeNull();
  });
});
