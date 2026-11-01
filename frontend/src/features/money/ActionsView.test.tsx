import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { SAMPLE, TODAY } from "../finley/finleyFixture";
import { ActionsView } from "./ActionsView";
import type { MoneyState } from "./model";

expect.extend(matchers);

/** Holds state like useMoney does, so decisions round-trip through onPlanning. */
function Harness({ initial }: { initial: MoneyState }) {
  const [state, setState] = useState(initial);
  return (
    <ActionsView
      state={state}
      today={TODAY}
      onPlanning={(fn) => setState((s) => ({ ...s, planning: fn(s.planning) }))}
    />
  );
}

describe("ActionsView", () => {
  it("shows each action with its rule, figures, impact, and trade-offs", () => {
    render(<Harness initial={SAMPLE} />);
    const card = screen
      .getByRole("heading", { name: "Card charges 24% APR" })
      .closest("li")!;
    expect(within(card).getByText("Worth a look")).toBeInTheDocument();
    expect(within(card).getByText("$20.00")).toBeInTheDocument();
    expect(
      within(card).getByText(/lowers the interest by about \$2\.00/),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/check your reserve first/),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Open Debts" }),
    ).toHaveAttribute("href", "#/money/debts");
    expect(screen.getByText(/not financial advice/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "How this list is made" }),
    ).toBeInTheDocument();
  });

  it("marks done, hides for 30 days, dismisses, and puts back", async () => {
    const user = userEvent.setup();
    render(<Harness initial={SAMPLE} />);
    const doneButtons = screen.getAllByRole("button", { name: "Mark done" });
    expect(doneButtons).toHaveLength(3);

    await user.click(doneButtons[0]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Marked done: Card charges 24% APR.",
    );
    expect(
      screen.queryByRole("heading", { name: "Card charges 24% APR" }),
    ).toBeNull();
    const aside = screen
      .getByRole("heading", { name: "Set aside" })
      .closest("section")!;
    expect(within(aside).getByText("(Marked done)")).toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: "Hide for 30 days" })[0],
    );
    expect(
      within(aside).getByText("(Hidden until 2026-11-23)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.getByText("Nothing needs attention under these rules today."),
    ).toBeInTheDocument();

    await user.click(
      within(aside).getByRole("button", {
        name: "Put back: Card charges 24% APR",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Card charges 24% APR" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Back on the list");
  });

  it("asks for an account first instead of showing an empty list", () => {
    render(<Harness initial={{ ...SAMPLE, accounts: [] }} />);
    expect(screen.getByText(/Add an account first/)).toBeInTheDocument();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("has no accessibility violations with items open and set aside", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness initial={SAMPLE} />);
    await user.click(screen.getAllByRole("button", { name: "Mark done" })[0]);
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
