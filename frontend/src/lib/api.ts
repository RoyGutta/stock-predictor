/**
 * Typed client for the Stock Predictor API.
 *
 * All network access goes through here so error handling, the base URL, and
 * request cancellation are defined in exactly one place.
 */

import type { Analysis, Quote, Range } from "../types/market";

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8001";

/** An error carrying a message that is safe to render to the user. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function messageForStatus(status: number, detail?: string): string {
  if (detail) return detail;
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The market data service is unavailable. Try again shortly.";
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
    if (isAbort(error)) throw error;
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
  const query = new URLSearchParams({ range });
  return request<Quote>(`/api/v1/stocks/${encodeURIComponent(ticker)}?${query}`, signal);
}

/** Fetch indicators, risk statistics, and the interpretation for one ticker. */
export function fetchAnalysis(
  ticker: string,
  range: Range,
  period: number,
  signal?: AbortSignal,
): Promise<Analysis> {
  const query = new URLSearchParams({ range, period: String(period) });
  return request<Analysis>(
    `/api/v1/stocks/${encodeURIComponent(ticker)}/analysis?${query}`,
    signal,
  );
}
