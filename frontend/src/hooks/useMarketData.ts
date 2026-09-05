import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  fetchBacktest,
  fetchCapabilities,
  fetchCompare,
  fetchCorrelation,
  fetchPatterns,
  fetchMarketStatus,
  fetchMomentumRanking,
  fetchMovers,
  fetchNews,
  fetchProfile,
  fetchSectors,
  fetchSimulation,
  isAbort,
} from "../lib/api";
import type {
  BacktestResponse,
  CompareResponse,
  Capabilities,
  CompanyProfile,
  CorrelationResponse,
  MarketStatus,
  MomentumRankingResponse,
  MoversResponse,
  NewsResponse,
  PatternsResponse,
  Range,
  SectorPerformance,
  SimulationResponse,
} from "../types/market";

function toMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const IDLE = { data: null, loading: true, error: null };

/**
 * Load a value once on mount.
 *
 * Errors are captured into state rather than thrown: a market panel failing is
 * a normal condition (no key, rate limit, provider down) and must not take the
 * rest of the page with it.
 */
function useOnce<T>(loader: (signal: AbortSignal) => Promise<T>, enabled = true): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(IDLE as AsyncState<T>);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setState({ data: null, loading: false, error: toMessage(error) });
      });

    return () => controller.abort();
  }, [enabled]);

  return state;
}

export function useCapabilities(): AsyncState<Capabilities> {
  return useOnce(useCallback((signal: AbortSignal) => fetchCapabilities(signal), []));
}

export function useMarketStatus(): AsyncState<MarketStatus> {
  return useOnce(useCallback((signal: AbortSignal) => fetchMarketStatus(signal), []));
}

export function useMovers(enabled: boolean): AsyncState<MoversResponse> {
  return useOnce(useCallback((signal: AbortSignal) => fetchMovers(8, signal), []), enabled);
}

export function useSectors(enabled: boolean): AsyncState<SectorPerformance[]> {
  return useOnce(useCallback((signal: AbortSignal) => fetchSectors(signal), []), enabled);
}

const DORMANT: AsyncState<never> = { data: null, loading: false, error: null };

/**
 * Load a value that belongs to a key, refetching whenever the key changes.
 *
 * A null key means "nothing to load" and resets to dormant rather than
 * leaving the previous key's result on screen under a new name — the bug
 * this shape exists to prevent.
 *
 * `loader` is called through a ref so an inline arrow at the call site does
 * not retrigger the effect on every render; the key is what decides staleness.
 */
function useKeyed<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(DORMANT);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    if (key === null) {
      setState(DORMANT);
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setState({ data: null, loading: false, error: toMessage(error) });
      });

    return () => controller.abort();
  }, [key]);

  return state;
}

/** News for whichever ticker is on screen. Refetches when the ticker changes. */
export function useNews(ticker: string | null, enabled: boolean): AsyncState<NewsResponse> {
  const key = ticker && enabled ? ticker : null;
  return useKeyed(key, (signal) => fetchNews(ticker as string, 8, signal));
}

/** Backtest for whichever ticker is on screen. Only runs when asked. */
export function useBacktest(ticker: string | null, range: Range): AsyncState<BacktestResponse> {
  return useKeyed(ticker && `${ticker}:${range}`, (signal) =>
    fetchBacktest(ticker as string, range, signal),
  );
}

/** Company fundamentals for whichever ticker is on screen. */
export function useProfile(ticker: string | null, enabled: boolean): AsyncState<CompanyProfile> {
  const key = ticker && enabled ? ticker : null;
  return useKeyed(key, (signal) => fetchProfile(ticker as string, signal));
}

/** Dispersion simulation. Expensive, so it only runs when explicitly asked. */
export function useSimulation(
  ticker: string | null,
  range: Range,
): AsyncState<SimulationResponse> {
  return useKeyed(ticker && `${ticker}:${range}`, (signal) =>
    fetchSimulation(ticker as string, range, signal),
  );
}

/** Momentum ranking for a basket. Dormant when the basket is empty. */
export function useMomentumRanking(
  tickers: readonly string[],
  range: Range,
): AsyncState<MomentumRankingResponse> {
  const key = tickers.length > 0 ? `${[...tickers].join(",")}:${range}` : null;
  return useKeyed(key, (signal) => fetchMomentumRanking(tickers, range, signal));
}

/** Side-by-side comparison of a basket. Dormant below two tickers. */
export function useCompare(
  tickers: readonly string[],
  range: Range,
): AsyncState<CompareResponse> {
  const key = tickers.length >= 2 ? `cmp:${[...tickers].join(",")}:${range}` : null;
  return useKeyed(key, (signal) => fetchCompare(tickers, range, signal));
}

/** Historical pattern report for one ticker. Dormant until requested. */
export function usePatterns(
  ticker: string | null,
  range: Range,
): AsyncState<PatternsResponse> {
  const key = ticker ? `pat:${ticker}:${range}` : null;
  return useKeyed(key, (signal) => fetchPatterns(ticker as string, range, signal));
}

/** Correlation across a basket. Null or fewer than two tickers stays dormant. */
export function useCorrelation(
  tickers: readonly string[],
  range: Range,
  enabled: boolean,
): AsyncState<CorrelationResponse> {
  const key = enabled && tickers.length >= 2 ? `${[...tickers].join(",")}:${range}` : null;
  return useKeyed(key, (signal) => fetchCorrelation(tickers, range, signal));
}
