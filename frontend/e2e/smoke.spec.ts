import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Browser smoke suite over the production build.
 *
 * Every API call is answered from a recorded fixture, so these tests are
 * deterministic and never touch a market-data provider. They check what a
 * first-time visitor experiences -- orientation, navigation, persistence,
 * error guidance, and the language of every analytical panel -- not the
 * numbers themselves, which the unit and API suites own.
 */

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${FIXTURES}${name}.json`, "utf8");
}

const UNKNOWN_TICKER = "ZZZZNOTREAL";

/** Map a request path to a fixture, or to the 404 the real API would return. */
function respond(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const json = (body: string, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body });
  const notFound = (detail: string) => json(JSON.stringify({ detail }), 404);

  const stock = path.match(/^\/api\/v1\/stocks\/([^/]+)(\/analysis|\/patterns)?$/);
  if (stock) {
    const [, ticker, sub] = stock;
    if (ticker === UNKNOWN_TICKER || !["AAPL", "MSFT"].includes(ticker)) {
      return notFound(`No market data found for '${ticker}'.`);
    }
    if (sub === "/analysis") return json(fixture(`analysis-${ticker}`));
    if (sub === "/patterns") return json(fixture(`patterns-${ticker}`));
    return json(fixture(`quote-${ticker}`));
  }
  if (path.startsWith("/api/v1/market/news/")) return json(fixture("news-AAPL"));
  if (path.startsWith("/api/v1/market/profile/")) return json(fixture("profile-AAPL"));

  const simple: Record<string, string> = {
    "/api/v1/market/capabilities": "capabilities",
    "/api/v1/market/status": "status",
    "/api/v1/market/movers": "movers",
    "/api/v1/market/sectors": "sectors",
    "/api/v1/market/compare": "compare",
    "/api/v1/market/correlation": "correlation",
    "/api/v1/portfolio/simulation": "portfolio",
    "/api/v1/explore/match": "explore",
  };
  if (simple[path]) return json(fixture(simple[path]));
  return notFound(`No fixture for ${path}`);
}

/** Console errors other than the browser's own log line for a 4xx response. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource")) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

let consoleErrors: string[];

test.beforeEach(async ({ page }) => {
  consoleErrors = trackConsoleErrors(page);
  await page.route("**/api/v1/**", respond);
});

test.afterEach(() => {
  expect(consoleErrors, "the page must log no application errors").toEqual([]);
});

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "the page must never scroll sideways").toBe(false);
}

test("dashboard orients a first-time visitor", async ({ page }) => {
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: "What each tool does" })).toBeVisible();
  for (const [name, hash] of [
    ["Analyze", "#/analyze"],
    ["Explore", "#/explore"],
    ["Compare", "#/compare"],
    ["Portfolio", "#/portfolio"],
    ["Learn", "#/learn"],
  ]) {
    await expect(page.locator(".toolguide").getByRole("link", { name })).toHaveAttribute(
      "href",
      hash,
    );
  }
  await expect(page.getByText("Why nothing here predicts.")).toBeVisible();
  await expect(page.getByText("Where the numbers come from.")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("every navigation destination is visible at this viewport", async ({ page }) => {
  await page.goto("/#/dashboard");
  const links = page.locator(".app__nav-link");
  await expect(links).toHaveCount(6);
  const viewport = page.viewportSize()!.width;
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    expect(box, "nav link must be laid out").not.toBeNull();
    expect(box!.x + box!.width, "nav link must sit inside the viewport").toBeLessThanOrEqual(viewport);
  }
  await noHorizontalOverflow(page);
});

test("a deep link loads the security and describes its chart", async ({ page }) => {
  await page.goto("/#/analyze/AAPL");
  await expect(page.getByText("Apple Inc.").first()).toBeVisible();
  await expect(page.locator("[aria-label^='Price chart for AAPL']")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("recent searches persist across navigation, reload, and deep links", async ({ page }) => {
  await page.goto("/#/analyze/AAPL");
  await expect(page.getByText("Apple Inc.").first()).toBeVisible();

  const search = page
    .locator("main")
    .getByRole("textbox", { name: "Search for a company or ticker symbol" });
  await search.fill("msft");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/analyze\/MSFT$/);
  await expect(page.getByText("Microsoft Corporation").first()).toBeVisible();

  // Leave the page entirely, come back with no ticker: the list must survive.
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: "What each tool does" })).toBeVisible();
  await page.goto("/#/analyze");
  const recent = page.locator(".recent__button");
  await expect(recent).toHaveCount(2);
  await expect(recent.nth(0)).toContainText("MSFT");
  await expect(recent.nth(1)).toContainText("AAPL");

  // Survive a hard reload.
  await page.reload();
  await expect(page.locator(".recent__button")).toHaveCount(2);
  await expect(page.locator(".recent__button").nth(0)).toContainText("MSFT");

  // Clicking an entry navigates to its deep link and moves it to the front.
  await page.locator(".recent__button").nth(1).click();
  await expect(page).toHaveURL(/#\/analyze\/AAPL$/);
  await expect(page.getByText("Apple Inc.").first()).toBeVisible();
  await expect(page.locator(".recent__button").nth(0)).toContainText("AAPL");
});

test("an unknown ticker says what to do next and stays out of history", async ({ page }) => {
  await page.goto("/#/analyze/AAPL");
  await expect(page.getByText("Apple Inc.").first()).toBeVisible();

  await page.goto(`/#/analyze/${UNKNOWN_TICKER}`);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(`No market data found for '${UNKNOWN_TICKER}'`);
  await expect(alert).toContainText(/check the spelling/i);
  await expect(page.locator(".recent__button")).toHaveCount(1);
  await expect(page.locator(".recent__button")).toContainText("AAPL");
});

test("historical patterns are counted as occurrences, never as predictions", async ({ page }) => {
  await page.goto("/#/analyze/AAPL");
  await expect(page.getByText("Apple Inc.").first()).toBeVisible();
  await page.getByRole("button", { name: "Scan the history" }).click();

  await expect(page.getByRole("heading", { name: "Event timeline (most recent first)" })).toBeVisible();
  await expect(page.getByText(/\d+ occurrences?/).first()).toBeVisible();
  await expect(page.getByText(/not signals and not forecasts/)).toBeVisible();

  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const phrase of ["successful prediction", "winning signal", "buy now", "will rise"]) {
    expect(text).not.toContain(phrase);
  }
});

test("compare shows differences without naming a winner", async ({ page }) => {
  await page.goto("/#/compare");
  const input = page.locator("main input[type='text']").first();
  await input.fill("VOO, QQQ, AAPL");
  await input.press("Enter");

  await expect(page.locator("table caption", { hasText: "Historical characteristics" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Do these move together?" })).toBeVisible();
  await expect(page.locator("[class*='winner'], [class*='best'], [class*='leader']")).toHaveCount(0);
  await expect(page.getByText(/not which one to pick/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test("portfolio replay labels itself hypothetical and strips deposits from returns", async ({ page }) => {
  await page.goto("/#/portfolio");
  await page.getByRole("button", { name: "Run the replay" }).click();

  await expect(page.getByRole("heading", { name: "Hypothetical historical simulation" })).toBeVisible();
  await expect(page.getByText(/deposits are never counted as gains/)).toBeVisible();
  await expect(page.locator(".pf-table .infotip")).toHaveCount(3);
  await noHorizontalOverflow(page);
});

test("learn opens with the philosophy and lists the full learning path", async ({ page }) => {
  await page.goto("/#/learn");
  await expect(page.getByText("Why this app refuses to predict.")).toBeVisible();
  await expect(page.locator(".learn__item")).toHaveCount(17);
  await noHorizontalOverflow(page);
});

test("explore shows the whole disclosed universe, misses included", async ({ page }) => {
  await page.goto("/#/explore");
  await expect(page.getByRole("heading", { name: "How each fund matched" })).toBeVisible();
  const text = await page.locator("main").innerText();
  // A fund that missed most checks is still on the page.
  expect(text).toMatch(/1\/3/);
  expect(text).toMatch(/not a recommendation/i);
  await noHorizontalOverflow(page);
});

test("theme toggle switches and persists across reload", async ({ page }) => {
  await page.goto("/#/dashboard");
  const toggle = page.getByRole("button", { name: /dark mode|light mode/i });
  const before = (await toggle.textContent())?.trim();
  await toggle.click();
  const after = (await toggle.textContent())?.trim();
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.getByRole("button", { name: /dark mode|light mode/i })).toHaveText(after!);
});

test("@live real backend serves a quote for AAPL", async ({ page }) => {
  test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 with a backend on :8001 to run against live data");
  await page.unroute("**/api/v1/**");
  await page.goto("/#/analyze/AAPL");
  await expect(page.getByText("Apple Inc.").first()).toBeVisible({ timeout: 30_000 });
});
