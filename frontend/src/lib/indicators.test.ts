import { describe, expect, it } from "vitest";

import { bollingerBands, downsample, ema, sma } from "./indicators";

const series = (prices: number[]) => prices.map((price) => ({ price }));

describe("sma", () => {
  it("returns undefined until the window is full", () => {
    const result = sma(series([1, 2, 3, 4, 5]), 3);
    expect(result.slice(0, 2)).toEqual([undefined, undefined]);
  });

  it("computes the mean of the trailing window", () => {
    // windows: [1,2,3]=2, [2,3,4]=3, [3,4,5]=4
    expect(sma(series([1, 2, 3, 4, 5]), 3).slice(2)).toEqual([2, 3, 4]);
  });

  it("handles a period of 1 as the identity", () => {
    expect(sma(series([7, 8, 9]), 1)).toEqual([7, 8, 9]);
  });

  it("is stable on a flat series", () => {
    expect(sma(series([5, 5, 5, 5]), 2).slice(1)).toEqual([5, 5, 5]);
  });

  it("rejects a period below 1", () => {
    expect(() => sma(series([1, 2]), 0)).toThrow(RangeError);
  });

  it("returns an empty array for empty input", () => {
    expect(sma([], 5)).toEqual([]);
  });
});

describe("ema", () => {
  it("seeds from the SMA of the first window", () => {
    // SMA of [1,2,3] is 2, so index 2 must equal 2.
    expect(ema(series([1, 2, 3, 4, 5]), 3)[2]).toBe(2);
  });

  it("applies the smoothing factor after seeding", () => {
    // k = 2/(3+1) = 0.5; next = 4*0.5 + 2*0.5 = 3
    const result = ema(series([1, 2, 3, 4, 5]), 3);
    expect(result[3]).toBe(3);
    expect(result[4]).toBe(4); // 5*0.5 + 3*0.5
  });

  it("returns undefined before the seed point", () => {
    expect(ema(series([1, 2, 3, 4]), 3).slice(0, 2)).toEqual([undefined, undefined]);
  });

  it("equals the constant on a flat series", () => {
    const result = ema(series([10, 10, 10, 10, 10]), 3);
    expect(result.slice(2)).toEqual([10, 10, 10]);
  });

  it("rejects a period below 1", () => {
    expect(() => ema(series([1, 2]), 0)).toThrow(RangeError);
  });
});

describe("bollingerBands", () => {
  it("collapses to the mean when there is no variance", () => {
    const { upper, middle, lower } = bollingerBands(series([5, 5, 5, 5]), 2);
    expect(middle[3]).toBe(5);
    expect(upper[3]).toBe(5);
    expect(lower[3]).toBe(5);
  });

  it("places bands symmetrically around the mean", () => {
    const { upper, middle, lower } = bollingerBands(series([2, 4, 6, 8]), 2);
    const i = 3;
    expect(upper[i]! - middle[i]!).toBeCloseTo(middle[i]! - lower[i]!, 10);
  });

  it("uses population standard deviation", () => {
    // window [2,4]: mean 3, population sd = 1 -> bands at 3 +/- 2
    const { upper, lower } = bollingerBands(series([2, 4]), 2);
    expect(upper[1]).toBeCloseTo(5, 10);
    expect(lower[1]).toBeCloseTo(1, 10);
  });

  it("honours a custom standard deviation multiplier", () => {
    const { upper } = bollingerBands(series([2, 4]), 2, 1);
    expect(upper[1]).toBeCloseTo(4, 10);
  });

  it("returns undefined before the window fills", () => {
    const { upper } = bollingerBands(series([1, 2, 3]), 3);
    expect(upper.slice(0, 2)).toEqual([undefined, undefined]);
  });
});

describe("downsample", () => {
  it("returns the input unchanged when under the limit", () => {
    const data = [1, 2, 3];
    expect(downsample(data, 10)).toEqual([1, 2, 3]);
  });

  it("does not mutate the input", () => {
    const data = [1, 2, 3];
    downsample(data, 10);
    expect(data).toEqual([1, 2, 3]);
  });

  it("thins down to at most maxPoints (plus the retained last point)", () => {
    const data = Array.from({ length: 1000 }, (_, i) => i);
    expect(downsample(data, 100).length).toBeLessThanOrEqual(101);
  });

  it("always keeps the most recent point", () => {
    const data = Array.from({ length: 999 }, (_, i) => i);
    const result = downsample(data, 100);
    expect(result[result.length - 1]).toBe(998);
  });

  it("rejects a maxPoints below 2", () => {
    expect(() => downsample([1, 2, 3], 1)).toThrow(RangeError);
  });
});
