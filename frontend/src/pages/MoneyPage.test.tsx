import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { MONEY_SCHEMA_VERSION } from "../features/money/model";
import { STORAGE_KEY } from "../features/money/store";
import { MoneyPage } from "./MoneyPage";

expect.extend(matchers);

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  // Privacy: nothing in the Money Manager may make a network request.
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

async function addAccount(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  type: string,
  amount: string,
) {
  await user.click(screen.getByRole("button", { name: "Accounts" }));
  await user.click(screen.getByRole("button", { name: "Add account" }));
  await user.type(screen.getByLabelText("Name"), name);
  await user.selectOptions(screen.getByLabelText("Type"), type);
  const amountField = screen.getByLabelText(/Balance or value|Amount owed/);
  await user.clear(amountField);
  await user.type(amountField, amount);
  await user.click(screen.getByRole("button", { name: "Save account" }));
}

describe("Money Manager", () => {
  it("guides a first-time user without inventing any balances", async () => {
    render(<MoneyPage />);
    expect(
      screen.getByText(/nothing you enter here is sent to a server/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add your first account" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Net worth/)).not.toBeInTheDocument();
  });

  it("records accounts and transactions and computes the position", async () => {
    const user = userEvent.setup();
    render(<MoneyPage />);
    await addAccount(user, "Everyday", "checking", "1,000.00");
    await addAccount(user, "Visa", "credit_card", "200");

    await user.click(screen.getByRole("button", { name: "Transactions" }));
    await user.click(screen.getByRole("button", { name: "Add transaction" }));
    await user.selectOptions(screen.getByLabelText("What happened"), "expense");
    await user.type(screen.getByLabelText("Amount"), "60");
    await user.selectOptions(screen.getByLabelText("Account"), "Visa");
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    await user.click(screen.getByRole("button", { name: "Add transaction" }));
    await user.selectOptions(
      screen.getByLabelText("What happened"),
      "transfer",
    );
    await user.type(screen.getByLabelText("Amount"), "60");
    await user.selectOptions(screen.getByLabelText("From account"), "Everyday");
    await user.selectOptions(screen.getByLabelText("To account"), "Visa");
    await user.click(screen.getByRole("button", { name: "Save transaction" }));

    expect(screen.getByText("2 of 2 transactions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Overview" }));
    // $1,000 - $60 paid, card back to $200 owed: net worth $740.
    const stand = screen
      .getByRole("heading", { name: "Where you stand" })
      .closest("section")!;
    expect(within(stand).getByText("$740.00")).toBeInTheDocument();
    // Assets and liquid funds are both the $940 left in checking.
    expect(within(stand).getAllByText("$940.00")).toHaveLength(2);
    expect(within(stand).getByText("$200.00")).toBeInTheDocument();
  });

  it("persists across a reload of the page", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MoneyPage />);
    await addAccount(user, "Savings", "savings", "500");
    unmount();
    render(<MoneyPage />);
    await user.click(screen.getByRole("button", { name: "Accounts" }));
    expect(
      screen.getByText("Savings", { selector: ".money-item__name" }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).accounts,
    ).toHaveLength(1);
  });

  it("refuses invalid input with specific messages", async () => {
    const user = userEvent.setup();
    render(<MoneyPage />);
    await user.click(screen.getByRole("button", { name: "Accounts" }));
    await user.click(screen.getByRole("button", { name: "Add account" }));
    await user.type(screen.getByLabelText(/Balance or value/), "12abc");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Give the account a name.");
    expect(alert).toHaveTextContent("Enter the balance as a number");
  });

  it("renders hostile imported text as inert text", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema_version: MONEY_SCHEMA_VERSION,
        categories: ["Uncategorized"],
        accounts: [
          {
            id: "a",
            name: "Acct",
            type: "checking",
            currency: "USD",
            institution: "",
            notes: "",
            opening_balance_cents: 0,
            opening_date: "2026-01-01",
            apr: null,
            minimum_payment_cents: null,
            planned_payment_cents: null,
            due_day: null,
            archived: false,
          },
        ],
        transactions: [
          {
            id: "t",
            date: "2026-02-01",
            kind: "expense",
            amount_cents: 100,
            account_id: "a",
            to_account_id: null,
            interest_cents: 0,
            category: "Uncategorized",
            splits: [],
            description: '<img src=x onerror="window.__pwned=1">',
            notes: "",
            status: "settled",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<MoneyPage />);
    await user.click(screen.getByRole("button", { name: "Transactions" }));
    expect(
      screen.getByText('<img src=x onerror="window.__pwned=1">'),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("explains corrupt saved data and does not overwrite newer-version data", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schema_version: MONEY_SCHEMA_VERSION + 1,
        accounts: [],
        transactions: [],
      }),
    );
    const before = localStorage.getItem(STORAGE_KEY);
    const user = userEvent.setup();
    render(<MoneyPage />);
    expect(screen.getByText(/saved by a newer version/)).toBeInTheDocument();
    await addAccount(user, "Test", "cash", "10");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });

  it("does not show months before tracking began as zero", async () => {
    const user = userEvent.setup();
    render(<MoneyPage />);
    await addAccount(user, "Fresh", "checking", "100");
    await user.click(screen.getByRole("button", { name: "Overview" }));
    // The account starts today, so no complete month has been tracked yet.
    expect(screen.getByText(/no monthly history yet/)).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: /Complete months/ }),
    ).not.toBeInTheDocument();
  });

  it("requires typing DELETE before removing everything", async () => {
    const user = userEvent.setup();
    render(<MoneyPage />);
    await addAccount(user, "Wallet", "cash", "20");
    await user.click(screen.getByRole("button", { name: "Backup & data" }));
    const button = screen.getByRole("button", {
      name: "Delete all Money Manager data",
    });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(button);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(
      screen.getByText(/All Money Manager data was removed/),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations with data present", async () => {
    const user = userEvent.setup();
    const { container } = render(<MoneyPage />);
    await addAccount(user, "Everyday", "checking", "1000");
    await addAccount(user, "Loan", "student_loan", "5000");
    for (const tab of [
      "Overview",
      "Accounts",
      "Transactions",
      "Backup & data",
    ]) {
      await user.click(screen.getByRole("button", { name: tab }));
      const results = await axe(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(results).toHaveNoViolations();
    }
  });
});
