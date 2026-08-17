import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_WATCHLIST, useWatchlist } from "./useWatchlist";
import { storageKey } from "../../lib/storage";

const KEY = storageKey("watchlist");

beforeEach(() => {
  localStorage.clear();
});

describe("useWatchlist", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.tickers).toEqual([]);
  });

  it("adds and removes by toggling", () => {
    const { result } = renderHook(() => useWatchlist());

    act(() => result.current.toggle("aapl"));
    expect(result.current.tickers).toEqual(["AAPL"]);
    expect(result.current.has("AAPL")).toBe(true);

    act(() => result.current.toggle("AAPL"));
    expect(result.current.tickers).toEqual([]);
  });

  it("normalizes case and whitespace so a symbol cannot be added twice", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => result.current.toggle("  aapl  "));
    act(() => result.current.toggle("AAPL"));
    expect(result.current.tickers).toEqual([]);
  });

  it("ignores an empty symbol", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => result.current.toggle("   "));
    expect(result.current.tickers).toEqual([]);
  });

  it("puts the newest addition first", () => {
    /* The thing just added is the thing being looked at. */
    const { result } = renderHook(() => useWatchlist());
    act(() => result.current.toggle("AAPL"));
    act(() => result.current.toggle("MSFT"));
    expect(result.current.tickers).toEqual(["MSFT", "AAPL"]);
  });

  it("persists across remounts", () => {
    const first = renderHook(() => useWatchlist());
    act(() => first.result.current.toggle("AAPL"));
    first.unmount();

    const second = renderHook(() => useWatchlist());
    expect(second.result.current.tickers).toEqual(["AAPL"]);
  });

  it("recovers from a corrupt stored value rather than crashing", () => {
    localStorage.setItem(KEY, "{{{not json");
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.tickers).toEqual([]);
  });

  it("drops non-string entries written by an older build", () => {
    localStorage.setItem(KEY, JSON.stringify(["AAPL", 7, null, "MSFT"]));
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.tickers).toEqual(["AAPL", "MSFT"]);
  });

  it("de-duplicates a stored list that differs only by case", () => {
    localStorage.setItem(KEY, JSON.stringify(["aapl", "AAPL", "Aapl"]));
    const { result } = renderHook(() => useWatchlist());
    expect(result.current.tickers).toEqual(["AAPL"]);
  });

  it("caps the list and reports when it is full", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => {
      for (let i = 0; i < MAX_WATCHLIST + 5; i += 1) result.current.toggle(`TK${i}`);
    });
    expect(result.current.tickers).toHaveLength(MAX_WATCHLIST);
    expect(result.current.isFull).toBe(true);
  });

  it("clears every entry", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => result.current.toggle("AAPL"));
    act(() => result.current.clear());
    expect(result.current.tickers).toEqual([]);
  });

  it("removes a specific ticker regardless of case", () => {
    const { result } = renderHook(() => useWatchlist());
    act(() => result.current.toggle("AAPL"));
    act(() => result.current.remove("aapl"));
    expect(result.current.tickers).toEqual([]);
  });
});
