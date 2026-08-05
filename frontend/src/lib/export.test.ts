import { describe, expect, it } from "vitest";

import { buildHistoryCsv, toCsv } from "./export";
import type { Candle, IndicatorSeries } from "../types/market";

const candles: Candle[] = [
  { date: "2026-01-02", price: 101, open: 100, high: 102, low: 99, volume: 1000 },
  { date: "2026-01-03", price: 103, open: 101, high: 104, low: 100, volume: 2000 },
];

function series(overrides: Partial<IndicatorSeries> = {}): IndicatorSeries {
  return {
    dates: ["2026-01-02", "2026-01-03"],
    sma: [null, 102],
    ema: [null, 102.5],
    bollinger_upper: [null, 105],
    bollinger_lower: [null, 99],
    rsi: [null, 61.2],
    macd: [null, 0.4],
    macd_signal: [null, 0.2],
    macd_histogram: [null, 0.2],
    period: 20,
    ...overrides,
  };
}

describe("toCsv", () => {
  it("joins rows with CRLF", () => {
    expect(toCsv([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2");
  });

  it("quotes fields containing a comma", () => {
    expect(toCsv([["Apple, Inc."]])).toBe('"Apple, Inc."');
  });

  it("escapes embedded quotes by doubling them", () => {
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
  });

  it("quotes fields containing newlines", () => {
    expect(toCsv([["line1\nline2"]])).toBe('"line1\nline2"');
  });

  it("writes null as an empty field, not the text null", () => {
    expect(toCsv([[1, null, 3]])).toBe("1,,3");
  });

  it("leaves plain values unquoted", () => {
    expect(toCsv([["AAPL", 101.5]])).toBe("AAPL,101.5");
  });
});

describe("buildHistoryCsv", () => {
  it("writes a header and one row per candle", () => {
    const lines = buildHistoryCsv(candles, null).split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("date,open,high,low,close,volume");
  });

  it("maps the candle's price to the close column", () => {
    const [, first] = buildHistoryCsv(candles, null).split("\r\n");
    expect(first).toBe("2026-01-02,100,102,99,101,1000");
  });

  it("names indicator columns with the period actually used", () => {
    const header = buildHistoryCsv(candles, series({ period: 50 })).split("\r\n")[0];
    expect(header).toContain("sma_50");
    expect(header).toContain("ema_50");
  });

  it("leaves undefined indicator values blank rather than zero", () => {
    const [, first] = buildHistoryCsv(candles, series()).split("\r\n");
    // A 0 here would read as a real indicator value of zero.
    expect(first).toBe("2026-01-02,100,102,99,101,1000,,,,,");
  });

  it("includes indicator values once they are defined", () => {
    const [, , second] = buildHistoryCsv(candles, series()).split("\r\n");
    expect(second).toBe("2026-01-03,101,104,100,103,2000,102,102.5,105,99,61.2");
  });

  it("omits indicator columns entirely when no series is given", () => {
    expect(buildHistoryCsv(candles, null)).not.toContain("sma");
  });

  it("handles an empty history", () => {
    expect(buildHistoryCsv([], null).split("\r\n")).toHaveLength(1);
  });
});
