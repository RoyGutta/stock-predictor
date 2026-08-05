import { describe, expect, it } from "vitest";

import {
  EMPTY,
  formatChange,
  formatPercent,
  formatPercentPlain,
  formatPrice,
  formatRatio,
  formatVolume,
} from "./format";

/**
 * The central property here: a value that could not be computed must never
 * render as "0". A missing Sharpe ratio shown as 0.00 reads as a real, bad
 * number rather than an absent one.
 */
describe("missing values", () => {
  const formatters = [
    ["formatPrice", formatPrice],
    ["formatChange", formatChange],
    ["formatPercent", formatPercent],
    ["formatPercentPlain", formatPercentPlain],
    ["formatRatio", formatRatio],
    ["formatVolume", formatVolume],
  ] as const;

  it.each(formatters)("%s renders null as an em dash", (_name, format) => {
    expect(format(null)).toBe(EMPTY);
  });

  it.each(formatters)("%s renders undefined as an em dash", (_name, format) => {
    expect(format(undefined)).toBe(EMPTY);
  });

  it.each(formatters)("%s renders NaN as an em dash", (_name, format) => {
    expect(format(Number.NaN)).toBe(EMPTY);
  });

  it.each(formatters)("%s renders Infinity as an em dash", (_name, format) => {
    expect(format(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });

  it.each(formatters)("%s still renders a real zero", (_name, format) => {
    expect(format(0)).not.toBe(EMPTY);
  });
});

describe("formatPrice", () => {
  it("always shows two decimal places", () => {
    expect(formatPrice(1234.5, "USD")).toBe("$1,234.50");
  });

  it("honours the currency", () => {
    expect(formatPrice(10, "EUR")).toContain("10.00");
  });
});

describe("formatChange", () => {
  it("marks a gain with a plus", () => {
    expect(formatChange(2.5)).toBe("+2.50");
  });

  it("marks a loss with a true minus sign, not a hyphen", () => {
    expect(formatChange(-2.5)).toBe("−2.50");
  });

  it("treats zero as non-negative", () => {
    expect(formatChange(0)).toBe("+0.00");
  });
});

describe("formatPercent", () => {
  it("converts a fraction to a signed percentage", () => {
    expect(formatPercent(0.0432)).toBe("+4.32%");
  });

  it("signs a negative fraction", () => {
    expect(formatPercent(-0.1)).toBe("−10.00%");
  });

  it("respects the digit count", () => {
    expect(formatPercent(0.12345, 1)).toBe("+12.3%");
  });
});

describe("formatPercentPlain", () => {
  it("omits the sign for figures that carry no direction", () => {
    expect(formatPercentPlain(0.26)).toBe("26.0%");
  });

  it("keeps a native minus for genuinely negative figures", () => {
    // Drawdown is negative by construction, so the sign is information.
    expect(formatPercentPlain(-0.138)).toBe("-13.8%");
  });
});

describe("formatVolume", () => {
  it("writes small volumes in full", () => {
    expect(formatVolume(1234)).toBe("1,234");
  });

  it("compacts large volumes", () => {
    expect(formatVolume(52_400_000)).toBe("52.4M");
  });
});

describe("formatRatio", () => {
  it("fixes to two decimals by default", () => {
    expect(formatRatio(1.7823)).toBe("1.78");
  });
});
