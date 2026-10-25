import { describe, expect, it } from "vitest";

import { account, recurring, stateWith, tx } from "./budgetFixtures";
import {
  addMonthsClamped,
  candidateToRecurring,
  detectSubscriptionCandidates,
  normalizeDescription,
  occurrences,
  unusualCategoryChanges,
  upcoming,
} from "./recurring";

describe("occurrences", () => {
  it("clamps monthly dates to month end without drifting", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    const item = recurring({ next_date: "2028-01-31", cadence: "monthly" });
    expect(occurrences(item, "2028-01-01", "2028-05-31")).toEqual([
      "2028-01-31",
      "2028-02-29", // leap year
      "2028-03-31",
      "2028-04-30",
      "2028-05-31",
    ]);
  });

  it("moves a Feb 29 yearly item to Feb 28 in other years and back in leap years", () => {
    const item = recurring({ next_date: "2028-02-29", cadence: "yearly" });
    expect(occurrences(item, "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("adds three months for quarterly, clamped", () => {
    const item = recurring({ next_date: "2026-11-30", cadence: "quarterly" });
    expect(occurrences(item, "2026-01-01", "2027-06-30")).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
    ]);
  });

  it("steps biweekly across month boundaries", () => {
    const item = recurring({ next_date: "2026-01-23", cadence: "biweekly" });
    expect(occurrences(item, "2026-01-01", "2026-03-10")).toEqual([
      "2026-01-23",
      "2026-02-06",
      "2026-02-20",
      "2026-03-06",
    ]);
  });

  it("includes end_date and stops after it", () => {
    const item = recurring({
      next_date: "2026-03-01",
      cadence: "weekly",
      end_date: "2026-03-15",
    });
    expect(occurrences(item, "2026-01-01", "2026-12-31")).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
    ]);
  });

  it("never produces dates before next_date or outside the window", () => {
    const item = recurring({ next_date: "2026-03-10", cadence: "monthly" });
    expect(occurrences(item, "2026-01-01", "2026-04-09")).toEqual([
      "2026-03-10",
    ]);
    expect(occurrences(item, "2026-04-11", "2026-05-09")).toEqual([]);
  });
});

describe("upcoming", () => {
  it("lists everything due in the next N days, by date", () => {
    const rent = recurring({ id: "rent", next_date: "2026-03-01" });
    const gym = recurring({
      id: "gym",
      description: "Gym",
      cadence: "weekly",
      next_date: "2026-03-16",
      amount_cents: 2_000,
    });
    const due = upcoming([rent, gym], "2026-03-20", 30);
    expect(due.map((u) => `${u.date} ${u.item.id}`)).toEqual([
      "2026-03-23 gym",
      "2026-03-30 gym",
      "2026-04-01 rent",
      "2026-04-06 gym",
      "2026-04-13 gym",
    ]);
  });
});

describe("detectSubscriptionCandidates", () => {
  const pay = (date: string, amount = 1_599, extra = {}) =>
    tx("expense", amount, date, {
      description: "NETFLIX.COM 1234",
      category: "Subscriptions",
      ...extra,
    });

  it("normalizes descriptions so reference numbers do not split a group", () => {
    expect(normalizeDescription("NETFLIX.COM #5678")).toBe(
      normalizeDescription("Netflix.com 1234"),
    );
  });

  it("proposes a monthly candidate from 3 regular payments, with evidence", () => {
    const [c] = detectSubscriptionCandidates([
      pay("2026-01-15"),
      pay("2026-02-15"),
      pay("2026-03-15"),
    ]);
    expect(c.cadence).toBe("monthly");
    expect(c.evidence.map((e) => e.date)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
    expect(c.intervals_days).toEqual([31, 28]);
    expect(c.median_interval_days).toBe(30);
    expect(c.typical_amount_cents).toBe(1_599);
    expect(c.confidence).toBe("medium");
    expect(c.suggested_next_date).toBe("2026-04-15");
  });

  it("rates 4+ identical regular payments high confidence", () => {
    const [c] = detectSubscriptionCandidates([
      pay("2026-01-15"),
      pay("2026-02-15"),
      pay("2026-03-15"),
      pay("2026-04-15"),
    ]);
    expect(c.confidence).toBe("high");
  });

  it("needs at least 3 payments", () => {
    expect(
      detectSubscriptionCandidates([pay("2026-01-15"), pay("2026-02-15")]),
    ).toEqual([]);
  });

  it("rejects irregular timing", () => {
    // Median gap 9 days: no cadence.
    expect(
      detectSubscriptionCandidates([
        pay("2026-01-01"),
        pay("2026-01-05"),
        pay("2026-02-20"),
        pay("2026-03-01"),
      ]),
    ).toEqual([]);
    // Median gap 30 days, but half the gaps are far off it.
    expect(
      detectSubscriptionCandidates([
        pay("2026-01-01"),
        pay("2026-01-31"),
        pay("2026-03-02"),
        pay("2026-05-01"),
        pay("2026-05-06"),
      ]),
    ).toEqual([]);
  });

  it("keeps only payments within 5% of the median amount", () => {
    const [c] = detectSubscriptionCandidates([
      pay("2026-01-10", 1_000),
      pay("2026-02-10", 1_040),
      pay("2026-02-20", 1_500),
      pay("2026-03-10", 1_000),
    ]);
    expect(c.evidence.map((e) => e.amount_cents)).toEqual([
      1_000, 1_040, 1_000,
    ]);
    expect(c.min_amount_cents).toBe(1_000);
    expect(c.max_amount_cents).toBe(1_040);
    expect(candidateToRecurring(c).certainty).toBe("estimated");
  });

  it("does not merge accounts, ignores pending, and skips tracked items", () => {
    const list = [
      pay("2026-01-15"),
      pay("2026-02-15", 1_599, { account_id: "card" }),
      pay("2026-03-15"),
      pay("2026-04-15", 1_599, { status: "pending" }),
    ];
    expect(detectSubscriptionCandidates(list)).toEqual([]);
    const regular = [pay("2026-01-15"), pay("2026-02-15"), pay("2026-03-15")];
    const tracked = recurring({
      description: "Netflix.com",
      account_id: "chk",
    });
    expect(detectSubscriptionCandidates(regular, [tracked])).toEqual([]);
  });

  it("converts a candidate to a recurring item only when asked", () => {
    const [c] = detectSubscriptionCandidates([
      pay("2026-01-15"),
      pay("2026-02-15"),
      pay("2026-03-15"),
    ]);
    const item = candidateToRecurring(c);
    expect(item).toMatchObject({
      kind: "expense",
      amount_cents: 1_599,
      cadence: "monthly",
      next_date: "2026-04-15",
      certainty: "fixed",
      category: "Subscriptions",
      account_id: "chk",
      end_date: null,
    });
  });
});

describe("unusualCategoryChanges", () => {
  const spend = (month: string, category: string, cents: number) =>
    tx("expense", cents, `${month}-10`, { category });
  const baseline = ["2026-01", "2026-02", "2026-03"].flatMap((m) => [
    spend(m, "Dining", 10_000),
    spend(m, "Groceries", 40_000),
    spend(m, "Books", 2_000),
  ]);

  it("flags a category at least 50% and $50 above its baseline average", () => {
    const state = stateWith([
      ...baseline,
      spend("2026-04", "Dining", 15_000), // +50%, +$50: flagged (boundary)
      spend("2026-04", "Groceries", 59_000), // +47.5%: not flagged
      spend("2026-04", "Books", 3_000), // +50% but only +$10: not flagged
      spend("2026-04", "Travel", 8_000), // new: +$80 from $0
    ]);
    const r = unusualCategoryChanges(state, "2026-05-10");
    expect(r.month).toBe("2026-04");
    expect(r.baseline_months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.changes).toEqual([
      {
        category: "Travel",
        last_month_cents: 8_000,
        baseline_average_cents: 0,
        increase_cents: 8_000,
        increase_ratio: null,
      },
      {
        category: "Dining",
        last_month_cents: 15_000,
        baseline_average_cents: 10_000,
        increase_cents: 5_000,
        increase_ratio: 0.5,
      },
    ]);
  });

  it("does not flag just under the thresholds", () => {
    const state = stateWith([...baseline, spend("2026-04", "Dining", 14_999)]);
    expect(unusualCategoryChanges(state, "2026-05-10").changes).toEqual([]);
  });

  it("leaves months before tracking began out of the baseline instead of counting zero", () => {
    const state = stateWith(
      [
        spend("2026-02", "Dining", 10_000),
        spend("2026-03", "Dining", 10_000),
        spend("2026-04", "Dining", 15_000),
      ],
      [account("chk", { opening_date: "2026-02-15" })],
    );
    const r = unusualCategoryChanges(state, "2026-05-10");
    expect(r.excluded_pre_tracking).toEqual(["2026-01"]);
    expect(r.baseline_months).toEqual(["2026-02", "2026-03"]);
    // Counting January as $0 would have made the average $66.67.
    expect(r.changes[0].baseline_average_cents).toBe(10_000);
  });

  it("says why when there is not enough history", () => {
    const state = stateWith(
      [spend("2026-03", "Dining", 10_000), spend("2026-04", "Dining", 90_000)],
      [account("chk", { opening_date: "2026-03-01" })],
    );
    const r = unusualCategoryChanges(state, "2026-05-10");
    expect(r.changes).toEqual([]);
    expect(r.unavailable_reason).toMatch(/at least 2/);
  });
});
