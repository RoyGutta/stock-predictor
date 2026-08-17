import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, fetchQuote, isAbort } from "../../lib/api";
import type { Quote } from "../../types/market";

/**
 * Concurrent in-flight quote requests.
 *
 * The API allows 60 requests a minute per client and the watchlist holds up to
 * 30 symbols, so a refresh has to be paced rather than fired all at once — a
 * burst would spend half the minute's budget instantly and rate-limit the rest
 * of the page. Four at a time keeps a full list under a couple of seconds
 * while leaving plenty of headroom.
 */
const CONCURRENCY = 4;

/**
 * Window each row's change is measured over.
 *
 * Not 1D, despite that being the conventional watchlist figure: a one-day
 * request returns nothing on a weekend or holiday, which would show every row
 * as an error for two days out of seven. A month is always populated.
 *
 * The tradeoff is that the number is *not* today's move, and an unlabelled
 * "+25%" beside MSFT reads as exactly that. `WATCHLIST_RANGE_LABEL` exists so
 * the UI is obliged to say which window it is showing.
 */
export const WATCHLIST_RANGE = "1M" as const;
export const WATCHLIST_RANGE_LABEL = "1-month change";

export interface WatchlistRow {
  ticker: string;
  quote: Quote | null;
  error: string | null;
}

export interface WatchlistQuotes {
  rows: WatchlistRow[];
  loading: boolean;
  /** When the most recent successful pass completed. Null before the first. */
  updatedAt: Date | null;
  refresh: () => void;
}

/** Run `task` over `items`, at most `limit` at a time, preserving input order. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Quotes for every ticker on the watchlist.
 *
 * A symbol that fails keeps its row and shows why, rather than vanishing — a
 * disappearing row reads as "we deleted your watchlist entry", which is a far
 * worse outcome than an inline error.
 */
export function useWatchlistQuotes(tickers: readonly string[]): WatchlistQuotes {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Identity of the list, so the effect reruns on content change rather than
  // on every render that happens to produce a new array instance.
  const key = tickers.join(",");

  const load = useCallback(async (symbols: readonly string[]) => {
    inFlight.current?.abort();
    if (symbols.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);

    const settled = await mapWithLimit(symbols, CONCURRENCY, async (ticker) => {
      try {
        const quote = await fetchQuote(ticker, WATCHLIST_RANGE, controller.signal);
        return { ticker, quote, error: null };
      } catch (error) {
        if (isAbort(error)) return { ticker, quote: null, error: null };
        return {
          ticker,
          quote: null,
          error: error instanceof ApiError ? error.message : "Could not load this ticker.",
        };
      }
    });

    if (controller.signal.aborted) return;
    setRows(settled);
    setLoading(false);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => {
    void load(key ? key.split(",") : []);
  }, [key, load]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const refresh = useCallback(() => {
    void load(key ? key.split(",") : []);
  }, [key, load]);

  return { rows, loading, updatedAt, refresh };
}
