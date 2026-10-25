import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { AxeMatchers } from "vitest-axe/matchers";
import * as matchers from "vitest-axe/matchers";

import { CORE_TOPICS } from "./coreTopics";
import { FinleyPanel } from "./FinleyPanel";
import { SAMPLE, TODAY } from "./finleyFixture";

expect.extend(matchers);
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}

const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

function renderPanel() {
  return render(
    <FinleyPanel state={SAMPLE} topics={CORE_TOPICS} today={TODAY} />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("FinleyPanel", () => {
  it("states it is rule-based, local, and not advice", () => {
    renderPanel();
    expect(screen.getByText(/not an AI model/)).toBeInTheDocument();
    expect(screen.getByText(/not sent anywhere/)).toBeInTheDocument();
  });

  it("answers a typed question from the user's records", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "What is my net worth?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const log = screen.getByRole("log");
    expect(log).toHaveTextContent("What is my net worth?");
    expect(log).toHaveTextContent("$6,000.00");
    expect(screen.getByLabelText("Your question")).toHaveValue("");
  });

  it("answers a suggested question and then offers its follow-ups", () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "What is my net worth?" }),
    );
    expect(
      screen.getByRole("button", { name: "How much cash do I have?" }),
    ).toBeInTheDocument();
  });

  it("ignores empty input and clears the conversation", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(
      screen.getByText(/Ask a question, or choose one below/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "What is my net worth?" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByText(/Ask a question, or choose one below/),
    ).toBeInTheDocument();
  });

  it("makes no network requests and stores nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "What is my net worth?" }),
    );
    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "Should I buy Tesla stock?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(
      screen.getByText("Finley does not recommend investments"),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("has no detectable accessibility violations with an answer shown", async () => {
    const { container } = renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "What is my net worth?" }),
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
