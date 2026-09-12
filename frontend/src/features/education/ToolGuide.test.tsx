import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import { ToolGuide } from "./ToolGuide";

expect.extend(matchers);

/**
 * First-run orientation must name every tool by the question it answers, link
 * to each, state the no-prediction philosophy, and never drift into
 * recommendation language while doing so.
 */
describe("ToolGuide", () => {
  it("links to every tool page", () => {
    render(<ToolGuide />);
    for (const [name, hash] of [
      ["Analyze", "#/analyze"],
      ["Explore", "#/explore"],
      ["Compare", "#/compare"],
      ["Portfolio", "#/portfolio"],
      ["Learn", "#/learn"],
    ]) {
      const links = screen.getAllByRole("link", { name });
      expect(links[0]).toHaveAttribute("href", hash);
    }
  });

  it("frames each tool as a question it answers, not a verdict it gives", () => {
    render(<ToolGuide />);
    expect(screen.getByText(/what has this security actually done/i)).toBeInTheDocument();
    expect(screen.getByText(/how do these securities differ/i)).toBeInTheDocument();
    expect(screen.getByText(/what would a mix of funds have done/i)).toBeInTheDocument();
  });

  it("explains why nothing predicts and where the data comes from", () => {
    render(<ToolGuide />);
    expect(screen.getByText(/why nothing here predicts/i)).toBeInTheDocument();
    expect(screen.getByText(/where the numbers come from/i)).toBeInTheDocument();
    expect(screen.getByText(/never as zero/i)).toBeInTheDocument();
  });

  it("never renders advice or ranking language", () => {
    const { container } = render(<ToolGuide />);
    const text = container.textContent?.toLowerCase() ?? "";
    for (const phrase of [
      "you should",
      "we recommend",
      "best stock",
      "buy ",
      "sell ",
      "will rise",
      "real-time",
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("has no axe violations", async () => {
    const { container } = render(<ToolGuide />);
    expect(
      await axe(container, { rules: { "color-contrast": { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
