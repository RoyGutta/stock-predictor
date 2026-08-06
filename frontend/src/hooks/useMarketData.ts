import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  fetchCapabilities,
  fetchMarketStatus,
  fetchMovers,
  fetchNews,
  fetchSectors,
  isAbort,
} from "../lib/api";
import type {
  Capabilities,
  MarketStatus,
  MoversResponse,
  NewsResponse,
  SectorPerformance,
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

/** News for whichever ticker is on screen. Refetches when the ticker changes. */
export function useNews(ticker: string | null, enabled: boolean): AsyncState<NewsResponse> {
  const [state, setState] = useState<AsyncState<NewsResponse>>({
    data: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!ticker || !enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    fetchNews(ticker, 8, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (isAbort(error) || controller.signal.aborted) return;
        setState({ data: null, loading: false, error: toMessage(error) });
      });

    return () => controller.abort();
  }, [ticker, enabled]);

  return state;
}
