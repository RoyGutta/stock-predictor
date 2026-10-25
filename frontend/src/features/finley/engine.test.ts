import { describe, expect, it } from "vitest";

import { EMPTY_STATE } from "../money/model";
import { CORE_TOPICS } from "./coreTopics";
import { ask, guardrail, tokens } from "./engine";
import { SAMPLE, TODAY } from "./finleyFixture";

const ctx = { state: SAMPLE, today: TODAY };
const answer = (q: string, c = ctx) => ask(q, c, CORE_TOPICS);
const figure = (q: string, label: string) =>
  answer(q).figures.find((f) => f.label === label)?.value;

describe("matching", () => {
  it.each([
    ["What is my net worth?", "net_worth"],
    ["how much cash do I have", "cash"],
    ["How much did I spend last month?", "spending_last_month"],
    ["What have I spent this month?", "spending_this_month"],
    ["what's my savings rate", "savings_rate"],
    ["What do I owe on my credit card?", "debts"],
    ["How many months of spending does my cash cover?", "reserve"],
    ["Where is my data stored?", "privacy"],
    ["Who is Finley?", "about"],
    ["Is this an AI?", "about"],
  ])("%s -> %s", (q, topic) => {
    expect(answer(q).topic).toBe(topic);
  });

  it("returns the unmatched answer with suggestions for unknown questions", () => {
    const a = answer("purple elephants");
    expect(a.topic).toBe("unmatched");
    expect(a.follow_ups.length).toBeGreaterThan(0);
  });

  it("drops stop words and punctuation", () => {
    expect(tokens("What's my NET-worth?")).toEqual(["net", "worth"]);
  });

  it("is deterministic", () => {
    expect(answer("net worth")).toEqual(answer("net worth"));
  });
});

describe("guardrails", () => {
  it.each([
    ["Should I buy Apple stock?", "decline_trade"],
    ["what are the best stocks to own", "decline_trade"],
    ["Sell my shares today", "decline_trade"],
    ["Will the market crash?", "decline_predict"],
    ["Can you guarantee a 10% return?", "decline_predict"],
    ["How do I reduce my taxes?", "decline_professional"],
    ["Should I file for bankruptcy?", "decline_professional"],
    ["Connect to my bank account", "decline_execute"],
  ])("%s is declined as %s", (q, id) => {
    expect(answer(q).topic).toBe(id);
  });

  it("does not decline a spending question about the Taxes category", () => {
    expect(guardrail("How much did I spend on taxes?")).toBeNull();
  });

  it("never contains buy or sell instructions in any core answer", () => {
    for (const t of CORE_TOPICS) {
      const text = JSON.stringify(t.answer(ctx)).toLowerCase();
      expect(text).not.toMatch(/\byou should (buy|sell|invest)\b/);
    }
  });
});

describe("figures (known answers)", () => {
  it("net worth", () => {
    expect(figure("net worth", "Assets")).toBe("$7,500.00");
    expect(figure("net worth", "Debts")).toBe("$1,500.00");
    expect(figure("net worth", "Net worth")).toBe("$6,000.00");
  });

  it("last month's spending with top categories", () => {
    const a = answer("How much did I spend last month?");
    expect(a.title).toBe("Spending in September 2026");
    expect(figure("spend last month", "Spending")).toBe("$1,500.00");
    expect(a.figures.map((f) => f.label)).toEqual([
      "Spending",
      "Income",
      "Housing",
      "Groceries",
    ]);
    expect(a.basis).toContain("2026-09-01 to 2026-09-30");
  });

  it("savings rate averages only months with records", () => {
    expect(figure("savings rate", "Savings rate")).toBe("62.5%");
    expect(answer("savings rate").basis).toContain("last 1 complete month");
  });

  it("debts report missing inputs instead of assuming zero", () => {
    const a = answer("what do I owe");
    const loan = a.figures.find((f) => f.label === "Loan");
    expect(loan?.note).toMatch(/Missing interest rate and minimum payment/);
    const card = a.figures.find((f) => f.label === "Card");
    expect(card?.note).toMatch(
      /24% APR; about \d+ months at the minimum payment of \$30\.00/,
    );
  });

  it("reserve coverage and an unset target shown as missing", () => {
    expect(figure("emergency fund", "Months covered")).toBe("5.0");
    expect(figure("emergency fund", "Your target")).toBe("—");
  });

  it("says a month with no records is unknown, not zero spending", () => {
    const a = answer("spend last month", {
      state: SAMPLE,
      today: "2026-12-05",
    });
    expect(a.title).toBe("Spending in November 2026");
    expect(a.figures).toEqual([]);
    expect(a.text).toMatch(/no settled income or spending records/);
  });

  it("answers data questions without accounts by saying there is nothing yet", () => {
    for (const q of [
      "net worth",
      "cash",
      "spend last month",
      "debt",
      "savings rate",
      "emergency",
    ]) {
      const a = answer(q, { state: EMPTY_STATE, today: TODAY });
      expect(a.figures).toEqual([]);
      expect(a.text).toMatch(/no accounts/);
    }
  });
});
