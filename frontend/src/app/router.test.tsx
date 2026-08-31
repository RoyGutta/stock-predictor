import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavLink, RouteProvider } from "./router";
import { parseHash, routeToHash, useHashRoute } from "./routes";

describe("parseHash", () => {
  it("maps an empty hash to the dashboard", () => {
    expect(parseHash("")).toEqual({ page: "dashboard", param: null });
    expect(parseHash("#/")).toEqual({ page: "dashboard", param: null });
    expect(parseHash("#")).toEqual({ page: "dashboard", param: null });
  });

  it("parses a page without a parameter", () => {
    expect(parseHash("#/compare")).toEqual({ page: "compare", param: null });
    expect(parseHash("#/learn")).toEqual({ page: "learn", param: null });
  });

  it("parses a page with a parameter", () => {
    expect(parseHash("#/analyze/AAPL")).toEqual({ page: "analyze", param: "AAPL" });
  });

  it("decodes encoded parameters", () => {
    expect(parseHash("#/analyze/BRK.B")).toEqual({ page: "analyze", param: "BRK.B" });
    expect(parseHash("#/analyze/%5EGSPC")).toEqual({ page: "analyze", param: "^GSPC" });
  });

  it("is case-insensitive about the page segment", () => {
    expect(parseHash("#/Analyze/AAPL").page).toBe("analyze");
  });

  it("falls back to the dashboard for unknown pages rather than a dead end", () => {
    expect(parseHash("#/no-such-page")).toEqual({ page: "dashboard", param: null });
    expect(parseHash("#/admin/../etc")).toEqual({ page: "dashboard", param: null });
  });

  it("treats a trailing slash and empty param as no param", () => {
    expect(parseHash("#/analyze/")).toEqual({ page: "analyze", param: null });
  });
});

describe("routeToHash", () => {
  it("round-trips with parseHash", () => {
    for (const [page, param] of [
      ["dashboard", null],
      ["analyze", "AAPL"],
      ["analyze", "BRK.B"],
      ["analyze", "^GSPC"],
      ["portfolio", null],
    ] as const) {
      expect(parseHash(routeToHash(page, param))).toEqual({ page, param });
    }
  });
});

function CurrentPage() {
  const route = useHashRoute();
  return <span data-testid="page">{route.page}</span>;
}

describe("useHashRoute", () => {
  it("follows hashchange events", async () => {
    window.location.hash = "#/learn";
    render(<CurrentPage />);
    expect(screen.getByTestId("page")).toHaveTextContent("learn");

    await act(async () => {
      window.location.hash = "#/compare";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByTestId("page")).toHaveTextContent("compare");
    window.location.hash = "";
  });
});

describe("NavLink", () => {
  it("marks the active page with aria-current", () => {
    window.location.hash = "#/compare";
    render(
      <RouteProvider>
        <nav>
          <NavLink to="compare">Compare</NavLink>
          <NavLink to="learn">Learn</NavLink>
        </nav>
      </RouteProvider>,
    );
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Learn" })).not.toHaveAttribute("aria-current");
    window.location.hash = "";
  });
});
