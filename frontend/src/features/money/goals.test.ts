import { describe, expect, it } from "vitest";

import {
  account,
  goal,
  makeState,
  recurring,
  tx,
} from "../../test/planningFixtures";
import {
  compareScenario,
  feasibility,
  goalProgress,
  monthlyEquivalent,
  projectWithReturn,
  wholeMonthsBetween,
} from "./goals";

const EMPTY = makeState([account("checking", "checking", 0)]);

describe("wholeMonthsBetween", () => {
  it("counts whole calendar months only", () => {
    expect(wholeMonthsBetween("2026-01-15", "2026-07-15")).toBe(6);
    expect(wholeMonthsBetween("2026-01-15", "2026-07-14")).toBe(5);
    expect(wholeMonthsBetween("2026-03-10", "2026-03-31")).toBe(0);
    expect(wholeMonthsBetween("2026-11-20", "2027-02-20")).toBe(3);
  });

  it("treats a clamped month end as a whole month", () => {
    expect(wholeMonthsBetween("2026-01-31", "2026-02-28")).toBe(1);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-27")).toBe(0);
  });
});

describe("goalProgress", () => {
  it("divides the remainder by whole months to the target date, rounding up", () => {
    const p = goalProgress(
      goal("g", { target_cents: 120_000, target_date: "2026-07-15" }),
      EMPTY,
      "2026-01-15",
    );
    expect(p.months_to_target).toBe(6);
    expect(p.required_monthly_cents).toBe(20_000);
    const odd = goalProgress(
      goal("g", { target_cents: 100_001, target_date: "2026-07-14" }),
      EMPTY,
      "2026-01-15",
    );
    expect(odd.months_to_target).toBe(5);
    expect(odd.required_monthly_cents).toBe(20_001); // ceil(100001 / 5)
  });

  it("uses at least one month and says when the date has passed", () => {
    const soon = goalProgress(
      goal("g", { target_cents: 50_000, target_date: "2026-03-20" }),
      EMPTY,
      "2026-03-10",
    );
    expect(soon.months_to_target).toBe(1);
    expect(soon.required_monthly_cents).toBe(50_000);
    const late = goalProgress(
      goal("g", { target_cents: 50_000, target_date: "2026-01-01" }),
      EMPTY,
      "2026-03-10",
    );
    expect(late.status).toBe("past_due");
    expect(late.required_reason).toMatch(/passed/);
  });

  it("returns null with a reason, never zero, when there is no date", () => {
    const p = goalProgress(goal("g"), EMPTY, "2026-01-15");
    expect(p.required_monthly_cents).toBeNull();
    expect(p.required_reason).toBe("No target date is set.");
    expect(p.status).toBe("no_date");
  });

  it("estimates completion at the planned contribution, month-end clamped", () => {
    const p = goalProgress(
      goal("g", { target_cents: 100_000, monthly_contribution_cents: 30_000 }),
      EMPTY,
      "2026-01-15",
    );
    expect(p.completion_months).toBe(4);
    expect(p.completion_date).toBe("2026-05-15");
    const clamp = goalProgress(
      goal("g", { target_cents: 100_000, monthly_contribution_cents: 100_000 }),
      EMPTY,
      "2026-01-31",
    );
    expect(clamp.completion_date).toBe("2026-02-28");
  });

  it("gives no completion date for a missing or zero contribution", () => {
    const none = goalProgress(goal("g"), EMPTY, "2026-01-15");
    expect(none.completion_date).toBeNull();
    expect(none.completion_reason).toMatch(/No monthly contribution/);
    const zero = goalProgress(
      goal("g", { monthly_contribution_cents: 0 }),
      EMPTY,
      "2026-01-15",
    );
    expect(zero.completion_date).toBeNull();
    expect(zero.completion_reason).toMatch(/zero/);
  });

  it("compares planned with required for on-track status", () => {
    const base = { target_cents: 120_000, target_date: "2026-07-15" };
    expect(
      goalProgress(
        goal("g", { ...base, monthly_contribution_cents: 20_000 }),
        EMPTY,
        "2026-01-15",
      ).status,
    ).toBe("on_track");
    expect(
      goalProgress(
        goal("g", { ...base, monthly_contribution_cents: 19_999 }),
        EMPTY,
        "2026-01-15",
      ).status,
    ).toBe("behind");
    expect(goalProgress(goal("g", base), EMPTY, "2026-01-15").status).toBe(
      "no_plan",
    );
  });

  it("funds from linked asset accounts and ignores the entered amount", () => {
    const state = makeState(
      [
        account("savings", "savings", 50_000),
        account("checking", "checking", 30_000),
        account("card", "credit_card", 20_000),
      ],
      [
        tx("income", 10_000, "savings", "2026-02-01"),
        tx("income", 99_999, "savings", "2026-02-02", { status: "pending" }),
      ],
    );
    const p = goalProgress(
      goal("g", {
        target_cents: 200_000,
        funded_cents: 999_999,
        linked_account_ids: ["savings", "checking", "card"],
      }),
      state,
      "2026-03-01",
    );
    expect(p.funded_basis).toBe("linked_accounts");
    expect(p.funded_cents).toBe(90_000); // 60,000 settled savings + 30,000 checking
    expect(p.remaining_cents).toBe(110_000);
    expect(p.progress).toBeCloseTo(0.45);
    expect(p.funded_notes).toEqual([
      "card is a debt, so it is not counted as money set aside.",
    ]);
  });

  it("uses the entered amount when nothing is linked, and reaches at the target", () => {
    const p = goalProgress(
      goal("g", { target_cents: 50_000, funded_cents: 60_000 }),
      EMPTY,
      "2026-03-01",
    );
    expect(p.funded_basis).toBe("entered");
    expect(p.remaining_cents).toBe(0);
    expect(p.progress).toBe(1);
    expect(p.status).toBe("reached");
    expect(p.required_monthly_cents).toBe(0);
  });
});

describe("projectWithReturn (hypothetical)", () => {
  const closedForm = (remaining: number, c: number, annual: number) => {
    const r = annual / 100 / 12;
    return r === 0
      ? Math.ceil(remaining / c)
      : Math.ceil(Math.log(1 + (remaining * r) / c) / Math.log(1 + r));
  };

  it("matches the closed-form month count", () => {
    expect(projectWithReturn(1_200_000, 50_000, 0).months).toBe(24);
    expect(projectWithReturn(1_200_000, 50_000, 6).months).toBe(23);
    for (const [rem, c, rate] of [
      [5_000_000, 75_000, 4],
      [2_500_000, 20_000, 7],
      [10_000_000, 150_000, 5],
    ]) {
      expect(projectWithReturn(rem, c, rate).months).toBe(
        closedForm(rem, c, rate),
      );
    }
  });

  it("reports growth as the balance minus contributions, near the annuity value", () => {
    const s = projectWithReturn(1_200_000, 50_000, 6);
    expect(s.contributed_cents).toBe(23 * 50_000);
    const fv = 50_000 * ((1.005 ** 23 - 1) / 0.005);
    expect(Math.abs(s.contributed_cents! + s.growth_cents! - fv)).toBeLessThan(
      25,
    );
  });

  it("is always labelled hypothetical and rejects bad input with a reason", () => {
    const s = projectWithReturn(100_000, 10_000, 5);
    expect(s.hypothetical).toBe(true);
    expect(s.basis).toMatch(/Not an expected return/);
    expect(projectWithReturn(100_000, 0, 5).months).toBeNull();
    expect(projectWithReturn(100_000, 10_000, 45).reason).toMatch(
      /between 0 and 30/,
    );
  });
});

describe("compareScenario", () => {
  it("returns both outcomes for a changed date or amount", () => {
    const g = goal("g", {
      target_cents: 120_000,
      target_date: "2026-07-15",
      monthly_contribution_cents: 10_000,
    });
    const { current, scenario } = compareScenario(
      g,
      { target_date: "2027-01-15", monthly_contribution_cents: 12_000 },
      EMPTY,
      "2026-01-15",
    );
    expect(current.required_monthly_cents).toBe(20_000);
    expect(current.status).toBe("behind");
    expect(scenario.required_monthly_cents).toBe(10_000);
    expect(scenario.status).toBe("on_track");
    expect(scenario.completion_date).toBe("2026-11-15"); // ceil(120000/12000) = 10 months
  });
});

describe("feasibility", () => {
  const months = ["01", "02", "03", "04"];
  const history = months.flatMap((m) => [
    tx("income", 500_000, "checking", `2026-${m}-15`),
    tx("expense", 150_000, "checking", `2026-${m}-01`, {
      category: "Housing",
      description: "Rent",
    }),
    tx("expense", 150_000, "checking", `2026-${m}-10`, {
      category: "Groceries",
    }),
  ]);
  const state = makeState(
    [
      account("checking", "checking", 100_000),
      account("card", "credit_card", 50_000),
    ],
    history,
    {
      recurring: [
        recurring("rent", {
          amount_cents: 150_000,
          category: "Housing",
          description: "Rent",
        }),
        recurring("gym", {
          amount_cents: 5_000,
          category: "Health",
          description: "Gym",
        }),
        recurring("cardpay", {
          kind: "transfer",
          amount_cents: 20_000,
          to_account_id: "card",
        }),
        recurring("old", { amount_cents: 99_000, end_date: "2026-01-01" }),
      ],
      goals: [
        goal("C", {
          priority: 3,
          target_cents: 300_000,
          target_date: "2026-11-10",
        }),
        goal("A", {
          priority: 1,
          target_cents: 600_000,
          target_date: "2026-11-10",
        }),
        goal("B", {
          priority: 2,
          target_cents: 360_000,
          target_date: "2026-11-10",
        }),
        goal("D", { priority: 4 }),
      ],
    },
  );
  const f = feasibility(state, "2026-05-10");

  it("averages only complete months since tracking began", () => {
    expect(f.months).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(f.average_income_cents).toBe(500_000);
    expect(f.average_spending_cents).toBe(300_000);
    expect(f.average_surplus_cents).toBe(200_000);
  });

  it("subtracts recurring commitments not already in spending", () => {
    expect(f.commitments.map((c) => c.item.id)).toEqual(["gym", "cardpay"]);
    expect(f.commitments_cents).toBe(25_000);
    expect(f.available_cents).toBe(175_000);
  });

  it("checks goals in priority order and reports the conflict with numbers", () => {
    expect(f.rows.map((r) => r.progress.goal.id)).toEqual(["A", "B", "C", "D"]);
    const [a, b, c, d] = f.rows;
    expect([a.needed_cents, a.fits]).toEqual([100_000, true]);
    expect([b.needed_cents, b.cumulative_cents, b.fits]).toEqual([
      60_000,
      160_000,
      true,
    ]);
    expect([c.needed_cents, c.cumulative_cents, c.fits]).toEqual([
      50_000,
      210_000,
      false,
    ]);
    expect(c.shortfall_cents).toBe(35_000);
    // 15,000 a month is left after A and B: 300,000 / 15,000 = 20 months.
    expect(c.fits_by_date).toBe("2028-01-10");
    expect(d.fits).toBeNull();
    expect(d.note).toMatch(/Not assessed/);
    expect(f.total_needed_cents).toBe(210_000);
  });

  it("does not assess without a complete month, rather than assuming zero", () => {
    const fresh = makeState(
      [account("checking", "checking", 0, { opening_date: "2026-05-01" })],
      [],
      {
        goals: [goal("A", { target_date: "2026-11-10" })],
      },
    );
    const out = feasibility(fresh, "2026-05-10");
    expect(out.available_cents).toBeNull();
    expect(out.available_reason).toMatch(/2026-05-01/);
    expect(out.rows[0].fits).toBeNull();
  });
});

describe("monthlyEquivalent", () => {
  it("converts cadences to a month", () => {
    expect(monthlyEquivalent(1_200, "weekly")).toBe(5_200);
    expect(monthlyEquivalent(1_200, "biweekly")).toBe(2_600);
    expect(monthlyEquivalent(1_200, "quarterly")).toBe(400);
    expect(monthlyEquivalent(1_200, "yearly")).toBe(100);
  });
});
