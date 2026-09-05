import { useCallback, useEffect, useState } from "react";

import {
  asArrayOf,
  asString,
  isRecord,
  readStored,
  storageKey,
  writeStored,
} from "../../lib/storage";

const KEY = storageKey("recent-searches");

/** Eight is enough to cover a comparison session without turning the sidebar
 *  into a second watchlist. */
export const MAX_RECENT = 8;

/**
 * Only identity is stored — deliberately no price, change, or timestamp.
 * A price persisted today and rendered next week would be stale market data
 * shown without a label, which this app never does. The list is a navigation
 * aid; live numbers belong to the watchlist, which refetches them.
 */
export interface RecentSearch {
  ticker: string;
  company_name: string;
}

/** Mirrors the backend's `_TICKER_PATTERN` (market_data.py) so anything the
 *  API accepted — including `^GSPC`-style indices — can be remembered, and
 *  nothing else can. */
const TICKER_SHAPE = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/;

function asEntry(value: unknown): RecentSearch | null {
  if (!isRecord(value)) return null;
  const ticker = asString(value.ticker)?.trim().toUpperCase() ?? "";
  if (!TICKER_SHAPE.test(ticker)) return null;
  return { ticker, company_name: asString(value.company_name)?.trim() ?? "" };
}

function validate(value: unknown): RecentSearch[] | null {
  const entries = asArrayOf(value, asEntry);
  if (entries === null) return null;
  const seen = new Set<string>();
  return entries
    .filter((entry) => !seen.has(entry.ticker) && (seen.add(entry.ticker), true))
    .slice(0, MAX_RECENT);
}

export interface RecentSearches {
  entries: RecentSearch[];
  /** Record a successful lookup. Most recent first; revisits move to the front. */
  record: (ticker: string, companyName: string) => void;
  clear: () => void;
}

/**
 * Recently analyzed tickers, persisted locally so the list survives leaving
 * the Analyze page and reloading the browser. Only successful lookups are
 * recorded — a typo that 404s never enters the history.
 */
export function useRecentSearches(): RecentSearches {
  const [entries, setEntries] = useState<RecentSearch[]>(() =>
    readStored(KEY, validate, []),
  );

  useEffect(() => {
    writeStored(KEY, entries);
  }, [entries]);

  const record = useCallback((rawTicker: string, companyName: string) => {
    const ticker = rawTicker.trim().toUpperCase();
    if (!TICKER_SHAPE.test(ticker)) return;
    setEntries((current) => {
      const entry = { ticker, company_name: companyName.trim() };
      return [entry, ...current.filter((item) => item.ticker !== ticker)].slice(
        0,
        MAX_RECENT,
      );
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, record, clear };
}
