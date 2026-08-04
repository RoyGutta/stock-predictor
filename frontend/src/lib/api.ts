/**
 * Typed client for the Stock Predictor API.
 *
 * All network access goes through here so error handling, the base URL, and
 * request cancellation are defined in exactly one place.
 */

import type { Quote, Range } from "../types/market";

const BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8001";

/** An error carrying a message that is safe to render to the user. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function messageForStatus(status: number, detail?: string): string {
  if (detail) return detail;
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The market data service is unavailable. Please try again shortly.";
  return "Something went wrong loading that ticker.";
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      "Could not reach the market data service. Is the backend running?",
      0,
    );
  }

  if (!response.ok) {
    // The API returns { detail: string }; fall back if the body isn't JSON.
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      detail = undefined;
    }
    throw new ApiError(messageForStatus(response.status, detail), response.status);
  }

  return (await response.json()) as T;
}

/** Fetch a quote plus price history for one ticker. */
export function fetchQuote(
  ticker: string,
  range: Range,
  signal?: AbortSignal,
): Promise<Quote> {
  const path = `/api/v1/stocks/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`;
  return request<Quote>(path, signal);
}
