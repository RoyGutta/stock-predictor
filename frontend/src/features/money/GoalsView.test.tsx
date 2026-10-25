import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { account, goal, makeState, tx } from "../../test/planningFixtures";
import { GoalsView } from "./GoalsView";
import type { MoneyState } from "./model";
import type { PlanningState } from "./planning";

expect.extend(matchers);
const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 4, 10, 12)); // 2026-05-10 local
});
afterEach(() => vi.useRealTimers());

const history = ["01", "02", "03", "04"].flatMap((m) => [
  tx("income", 300_000, "checking", `2026-${m}-15`),
  tx("expense", 200_000, "checking", `2026-${m}-02`, { category: "Housing" }),
]);

function populated(): MoneyState {
  return makeState(
    [
      account("checking", "checking", 100_000),
      account("savings", "savings", 40_000),
    ],
    history,
    {
      goals: [
        goal("Car", {
          priority: 1,
          target_cents: 600_000,
          target_date: "2026-11-10",
          monthly_contribution_cents: 100_000,
        }),
        goal("Trip", {
          priority: 2,
          target_cents: 120_000,
          target_date: "2026-11-10",
          monthly_contribution_cents: 5_000,
        }),
        goal("Cushion", {
          priority: 3,
          target_cents: 100_000,
          linked_account_ids: ["savings"],
        }),
      ],
    },
  );
}

function setup(state: MoneyState) {
  let planning: PlanningState = state.planning;
  const onPlanning = vi.fn((fn: (p: PlanningState) => PlanningState) => {
    planning = fn(planning);
  });
  const view = render(<GoalsView state={state} onPlanning={onPlanning} />);
  return { view, onPlanning, planning: () => planning };
}

describe("GoalsView", () => {
  it("explains what a goal needs when there are none, with no axe violations", async () => {
    const { view } = setup(makeState([account("checking", "checking", 0)]));
    expect(screen.getByText(/No goals yet/)).toBeInTheDocument();
    expect(await axe(view.container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("shows progress, required versus planned, and status per goal", () => {
    setup(populated());
    expect(
      screen.getByRole("progressbar", { name: "Cushion progress" }),
    ).toHaveAttribute("value", "0.4");
    const car = screen
      .getByText("Car", { selector: ".money-item__name" })
      .closest("li")!;
    expect(within(car).getAllByText("$1,000.00")).toHaveLength(2); // required = planned
    expect(
      within(car).getByText(/meets the required amount/),
    ).toBeInTheDocument();
    const trip = screen
      .getByText("Trip", { selector: ".money-item__name" })
      .closest("li")!;
    expect(
      within(trip).getByText(/below the required amount/),
    ).toBeInTheDocument();
    expect(within(trip).getByText("$200.00")).toBeInTheDocument();
    expect(screen.getByText(/from linked accounts/)).toBeInTheDocument();
  });

  it("reports which goals fit together and the conflict with numbers", async () => {
    const { view } = setup(populated());
    const table = screen.getByRole("table", {
      name: "Goals checked in priority order",
    });
    // Surplus 1,000/month: Car needs 1,000 (fits), Trip 200 more (conflict).
    expect(
      within(table).getByText(/Conflict: short \$200\.00 a month/),
    ).toBeInTheDocument();
    expect(within(table).getAllByText("Fits")).toHaveLength(1);
    expect(
      screen.getByText(
        /assuming every higher-priority goal is funded in full first/,
      ),
    ).toBeInTheDocument();
    expect(await axe(view.container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("adds a goal with every field, linking accounts by checkbox", () => {
    const { onPlanning, planning } = setup(populated());
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    fireEvent.change(screen.getByLabelText("Goal name"), {
      target: { value: "House" },
    });
    fireEvent.change(screen.getByLabelText("Kind of goal"), {
      target: { value: "home" },
    });
    fireEvent.change(screen.getByLabelText("Target amount"), {
      target: { value: "50,000" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "savings" }));
    expect(screen.getByLabelText("Amount already set aside")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Target date (optional)"), {
      target: { value: "2030-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByLabelText("Planned monthly contribution (optional)"),
      { target: { value: "800" } },
    );
    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "Down payment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(onPlanning).toHaveBeenCalledTimes(1);
    const added = planning().goals.find((g) => g.name === "House")!;
    expect(added).toMatchObject({
      kind: "home",
      target_cents: 5_000_000,
      linked_account_ids: ["savings"],
      target_date: "2030-01-01",
      priority: 2,
      monthly_contribution_cents: 80_000,
      description: "Down payment",
    });
  });

  it("refuses an invalid goal and says why", () => {
    const { onPlanning } = setup(populated());
    fireEvent.click(screen.getByRole("button", { name: "Add goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(onPlanning).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Give the goal a name/);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /target amount greater than zero/,
    );
  });

  it("edits and deletes after confirmation", () => {
    const { planning } = setup(populated());
    fireEvent.click(screen.getByRole("button", { name: "Edit Trip" }));
    fireEvent.change(screen.getByLabelText("Target amount"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(planning().goals.find((g) => g.id === "Trip")!.target_cents).toBe(
      150_000,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Car" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(planning().goals.map((g) => g.id)).not.toContain("Car");
  });

  it("compares a what-if scenario and labels any return as hypothetical", () => {
    setup(populated());
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Trip" },
    });
    fireEvent.change(screen.getByLabelText("Different monthly amount"), {
      target: { value: "200" },
    });
    const changed = screen.getByRole("region", { name: "With the change" });
    expect(
      within(changed).getByText(/meets the required amount/),
    ).toBeInTheDocument();
    const asIs = screen.getByRole("region", { name: "As entered" });
    expect(
      within(asIs).getByText(/below the required amount/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Hypothetical annual return/), {
      target: { value: "5" },
    });
    expect(screen.getByText(/Hypothetical, not expected:/)).toBeInTheDocument();
    expect(screen.getByText(/Not an expected return/)).toBeInTheDocument();
  });
});
