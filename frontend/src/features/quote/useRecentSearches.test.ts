import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_RECENT, useRecentSearches } from "./useRecentSearches";
import { storageKey } from "../../lib/storage";

const KEY = storageKey("recent-searches");

beforeEach(() => {
  localStorage.clear();
});

describe("useRecentSearches", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toEqual([]);
  });

  it("records a lookup with normalized casing", () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.record("  aapl ", " Apple Inc. "));
    expect(result.current.entries).toEqual([
      { ticker: "AAPL", company_name: "Apple Inc." },
    ]);
  });

  it("moves a revisited ticker to the front instead of duplicating it", () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.record("AAPL", "Apple Inc."));
    act(() => result.current.record("MSFT", "Microsoft"));
    act(() => result.current.record("aapl", "Apple Inc."));
    expect(result.current.entries.map((entry) => entry.ticker)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });

  it("keeps most recent first", () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.record("AAPL", "Apple"));
    act(() => result.current.record("MSFT", "Microsoft"));
    act(() => result.current.record("VOO", "Vanguard S&P 500"));
    expect(result.current.entries.map((entry) => entry.ticker)).toEqual([
      "VOO",
      "MSFT",
      "AAPL",
    ]);
  });

  it("is bounded, dropping the oldest entry", () => {
    const { result } = renderHook(() => useRecentSearches());
    for (let index = 0; index <= MAX_RECENT; index += 1) {
      act(() => result.current.record(`T${index}`, `Company ${index}`));
    }
    expect(result.current.entries).toHaveLength(MAX_RECENT);
    // T0, the oldest, fell off; the newest is first.
    expect(result.current.entries[0].ticker).toBe(`T${MAX_RECENT}`);
    expect(
      result.current.entries.some((entry) => entry.ticker === "T0"),
    ).toBe(false);
  });

  it("refuses malformed ticker symbols", () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.record("", "Nothing"));
    act(() => result.current.record("   ", "Spaces"));
    act(() => result.current.record("not a ticker", "Sentence"));
    act(() => result.current.record("WAYTOOLONGSYMBOL1", "Too long"));
    expect(result.current.entries).toEqual([]);
  });

  it("accepts index-style symbols the backend accepts", () => {
    const { result } = renderHook(() => useRecentSearches());
    act(() => result.current.record("^GSPC", "S&P 500"));
    expect(result.current.entries[0].ticker).toBe("^GSPC");
  });

  it("persists across unmount and remount", () => {
    const first = renderHook(() => useRecentSearches());
    act(() => first.result.current.record("AAPL", "Apple Inc."));
    first.unmount();

    const second = renderHook(() => useRecentSearches());
    expect(second.result.current.entries).toEqual([
      { ticker: "AAPL", company_name: "Apple Inc." },
    ]);
  });

  it("clears both state and storage", () => {
    const first = renderHook(() => useRecentSearches());
    act(() => first.result.current.record("AAPL", "Apple Inc."));
    act(() => first.result.current.clear());
    expect(first.result.current.entries).toEqual([]);
    first.unmount();

    const second = renderHook(() => useRecentSearches());
    expect(second.result.current.entries).toEqual([]);
  });

  it("recovers from corrupt JSON rather than crashing", () => {
    localStorage.setItem(KEY, "{definitely not json");
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toEqual([]);
  });

  it("drops invalid entries from a tampered blob but keeps valid ones", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { ticker: "AAPL", company_name: "Apple Inc." },
        { ticker: "not a ticker", company_name: "Bad" },
        { ticker: 42, company_name: "Number" },
        "just a string",
        null,
        { company_name: "No ticker at all" },
        { ticker: "msft", company_name: "Microsoft" },
      ]),
    );
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toEqual([
      { ticker: "AAPL", company_name: "Apple Inc." },
      { ticker: "MSFT", company_name: "Microsoft" },
    ]);
  });

  it("deduplicates a tampered blob that repeats a ticker in mixed case", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { ticker: "aapl", company_name: "Apple" },
        { ticker: "AAPL", company_name: "Apple Inc." },
      ]),
    );
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].ticker).toBe("AAPL");
  });

  it("truncates a tampered blob that exceeds the cap", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        Array.from({ length: 40 }, (_, index) => ({
          ticker: `T${index}`,
          company_name: `Company ${index}`,
        })),
      ),
    );
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toHaveLength(MAX_RECENT);
  });

  it("tolerates a missing company name in an old blob", () => {
    localStorage.setItem(KEY, JSON.stringify([{ ticker: "AAPL" }]));
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current.entries).toEqual([{ ticker: "AAPL", company_name: "" }]);
  });
});
