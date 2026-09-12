import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchMarketStatus, fetchQuote } from "./api";

/**
 * The client's error messages are the only thing a user sees when a lookup
 * fails, so each must say what to do next, distinguish a typo from an
 * outage, and never leak server internals.
 */

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failureOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("api error messages", () => {
  it("turns a 404 into the server's detail plus a next step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(404, { detail: "No market data found for 'ZZZZ'." })),
    );
    const error = await failureOf(fetchQuote("ZZZZ", "1Y"));
    expect(error.status).toBe(404);
    expect(error.message).toContain("No market data found for 'ZZZZ'.");
    expect(error.message).toMatch(/check the spelling/i);
    expect(error.message).toMatch(/search by company name/i);
  });

  it("still offers a next step when a 404 carries no detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const error = await failureOf(fetchQuote("ZZZZ", "1Y"));
    expect(error.message).toMatch(/no market data found/i);
    expect(error.message).toMatch(/check the spelling/i);
  });

  it("passes a 400 validation detail through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(400, { detail: "Ticker must be 1-15 characters." })),
    );
    const error = await failureOf(fetchQuote("bad ticker", "1Y"));
    expect(error.status).toBe(400);
    expect(error.message).toBe("Ticker must be 1-15 characters.");
  });

  it("tells the user to wait on a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    const error = await failureOf(fetchMarketStatus());
    expect(error.status).toBe(429);
    expect(error.message).toMatch(/wait a moment/i);
  });

  it("distinguishes a provider outage from a bad ticker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    const error = await failureOf(fetchQuote("AAPL", "1Y"));
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/unavailable/i);
    expect(error.message).not.toMatch(/spelling/i);
  });

  it("reports an unreachable backend plainly, with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await failureOf(fetchQuote("AAPL", "1Y"));
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/could not reach/i);
  });

  it("lets an abort propagate untouched so callers can ignore stale requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );
    await expect(fetchQuote("AAPL", "1Y")).rejects.toMatchObject({ name: "AbortError" });
  });
});
