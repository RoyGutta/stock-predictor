import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";

import * as api from "../lib/api";
import type { Capabilities } from "../types/market";
import { ResearchPage } from "./ResearchPage";

expect.extend(matchers);

function capabilities(sec: boolean): Capabilities {
  return {
    movers: false,
    sectors: false,
    news: false,
    search: false,
    fundamentals: false,
    screener: false,
    notes: sec ? {} : { sec_filings: "SEC access is off on this test server." },
    prices: true,
    intraday: false,
    price_source: "Demo",
    adjustment: "split_and_dividend",
    demo: true,
    demo_note: null,
    sec_filings: sec,
  } as Capabilities;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResearchPage", () => {
  it("explains that the screener needs SEC access and requests nothing from SEC", async () => {
    vi.spyOn(api, "fetchCapabilities").mockResolvedValue(capabilities(false));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ResearchPage />);
    expect(
      screen.getByRole("heading", { name: "Research", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("SEC access is off on this test server."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not a ranking of investments/),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    const results = await axe(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
