/**
 * Client for GET /api/v1/sec/screener.
 *
 * `request()` in lib/api.ts is private, so this mirrors its contract: same
 * base URL, same ApiError with a message safe to render, aborts rethrown.
 */
import { ApiError, isAbort } from "../../lib/api";
import type { ScreenerQuery, ScreenerResponse } from "../../types/screener";

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

function messageForStatus(status: number, detail?: string): string {
  if (detail) return detail;
  if (status === 422) return "One of the screening criteria is not valid.";
  if (status === 429)
    return "SEC asked this server to slow down. Try again shortly.";
  if (status >= 500)
    return "SEC data is unavailable right now. Try again shortly.";
  return "Something went wrong running the screen.";
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError(
      "Could not reach the Stock Predictor service. Is the backend running?",
      0,
    );
  }
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { detail?: unknown };
      // FastAPI validation errors carry a list here; only a string is shown.
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      detail = undefined;
    }
    throw new ApiError(
      messageForStatus(response.status, detail),
      response.status,
    );
  }
  return (await response.json()) as T;
}

/** Query string for the screener; unset criteria are omitted, never sent as 0. */
export function screenerParams(query: ScreenerQuery): URLSearchParams {
  const params = new URLSearchParams();
  const numbers: [string, number | null][] = [
    ["min_revenue", query.minRevenue],
    ["min_growth", query.minGrowth],
    ["max_growth", query.maxGrowth],
    ["min_net_margin", query.minNetMargin],
    ["max_liabilities_to_assets", query.maxLiabilitiesToAssets],
  ];
  for (const [key, value] of numbers) {
    if (value !== null && Number.isFinite(value))
      params.set(key, String(value));
  }
  if (query.positiveFcf) params.set("positive_fcf", "true");
  const name = query.name.trim();
  if (name) params.set("name", name);
  if (query.sizeBand) params.set("size_band", query.sizeBand);
  params.set("sort", query.sort);
  params.set("order", query.order);
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  return params;
}

export function fetchScreener(
  query: ScreenerQuery,
  signal?: AbortSignal,
): Promise<ScreenerResponse> {
  return getJson<ScreenerResponse>(
    `/api/v1/sec/screener?${screenerParams(query)}`,
    signal,
  );
}
