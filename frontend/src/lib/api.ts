/**
 * Typed client for the Stock Predictor API.
 *
 * All network access goes through here so error handling, the base URL, and
 * request cancellation are defined in exactly one place.
 */

import type {
  Analysis,
  CompareResponse,
  ExplorePreferences,
  ExploreResponse,
  PatternsResponse,
  PortfolioSimulationResponse,
  BacktestResponse,
  Capabilities,
  CompanyProfile,
  CorrelationResponse,
  MarketStatus,
  MomentumRankingResponse,
  MoversResponse,
  NewsResponse,
  Quote,
  Range,
  SearchResult,
  SectorPerformance,
  SimulationResponse,
} from "../types/market";

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

// --- market-wide -----------------------------------------------------------

export function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return request<Capabilities>("/api/v1/market/capabilities", signal);
}

export function fetchMarketStatus(signal?: AbortSignal): Promise<MarketStatus> {
  return request<MarketStatus>("/api/v1/market/status", signal);
}

export function fetchMovers(limit = 8, signal?: AbortSignal): Promise<MoversResponse> {
  return request<MoversResponse>(`/api/v1/market/movers?limit=${limit}`, signal);
}

export function fetchSectors(signal?: AbortSignal): Promise<SectorPerformance[]> {
  return request<SectorPerformance[]>("/api/v1/market/sectors", signal);
}

/** Company fundamentals. Requires an FMP key; gated on the `fundamentals` capability. */
export function fetchProfile(ticker: string, signal?: AbortSignal): Promise<CompanyProfile> {
  return request<CompanyProfile>(
    `/api/v1/market/profile/${encodeURIComponent(ticker)}`,
    signal,
  );
}

export function fetchNews(ticker: string, limit = 8, signal?: AbortSignal): Promise<NewsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return request<NewsResponse>(
    `/api/v1/market/news/${encodeURIComponent(ticker)}?${query}`,
    signal,
  );
}

export function searchTickers(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return request<SearchResult[]>(`/api/v1/market/search?${params}`, signal);
}

/**
 * Bootstrapped dispersion of outcomes. Explicitly not a forecast — see the
 * `disclaimer` field, which the backend guarantees is populated.
 */
export function fetchSimulation(
  ticker: string,
  range: Range,
  signal?: AbortSignal,
): Promise<SimulationResponse> {
  const query = new URLSearchParams({ range });
  return request<SimulationResponse>(
    `/api/v1/stocks/${encodeURIComponent(ticker)}/simulation?${query}`,
    signal,
  );
}

/** Momentum state for a basket, ranked strongest first. */
export function fetchMomentumRanking(
  tickers: readonly string[],
  range: Range,
  signal?: AbortSignal,
): Promise<MomentumRankingResponse> {
  const query = new URLSearchParams({ tickers: tickers.join(","), range });
  return request<MomentumRankingResponse>(`/api/v1/market/momentum?${query}`, signal);
}

/** Pairwise return correlation for a small basket of tickers. */
export function fetchCorrelation(
  tickers: readonly string[],
  range: Range,
  signal?: AbortSignal,
): Promise<CorrelationResponse> {
  const query = new URLSearchParams({ tickers: tickers.join(","), range });
  return request<CorrelationResponse>(`/api/v1/market/correlation?${query}`, signal);
}

/** Walk-forward backtest of the built-in indicator rules. */
export function fetchBacktest(
  ticker: string,
  range: Range,
  signal?: AbortSignal,
): Promise<BacktestResponse> {
  const query = new URLSearchParams({ range });
  return request<BacktestResponse>(
    `/api/v1/stocks/${encodeURIComponent(ticker)}/backtest?${query}`,
    signal,
  );
}

/** Hypothetical historical simulation of a fixed-weight portfolio. */
export function fetchPortfolioSimulation(
  holdings: { ticker: string; weight: number }[],
  options: { range: Range; initial: number; monthly: number },
  signal?: AbortSignal,
): Promise<PortfolioSimulationResponse> {
  const query = new URLSearchParams({
    holdings: holdings.map((h) => `${h.ticker}:${h.weight.toFixed(4)}`).join(","),
    range: options.range,
    initial: String(options.initial),
    monthly: String(options.monthly),
  });
  return request<PortfolioSimulationResponse>(`/api/v1/portfolio/simulation?${query}`, signal);
}

/** Historical characteristics of several securities, measured identically. */
export function fetchCompare(
  tickers: readonly string[],
  range: Range,
  signal?: AbortSignal,
): Promise<CompareResponse> {
  const query = new URLSearchParams({ tickers: tickers.join(","), range });
  return request<CompareResponse>(`/api/v1/market/compare?${query}`, signal);
}

/** Match the curated fund universe against stated preferences. */
export function fetchExploreMatch(
  preferences: ExplorePreferences,
  signal?: AbortSignal,
): Promise<ExploreResponse> {
  const query = new URLSearchParams({
    volatility: preferences.volatility,
    diversification: preferences.diversification,
    horizon: preferences.horizon,
  });
  if (preferences.interests.length > 0) {
    query.set("interests", preferences.interests.join(","));
  }
  return request<ExploreResponse>(`/api/v1/explore/match?${query}`, signal);
}

/** Historical pattern events and what followed them. */
export function fetchPatterns(
  ticker: string,
  range: Range,
  signal?: AbortSignal,
): Promise<PatternsResponse> {
  const query = new URLSearchParams({ range });
  return request<PatternsResponse>(
    `/api/v1/stocks/${encodeURIComponent(ticker)}/patterns?${query}`,
    signal,
  );
}
