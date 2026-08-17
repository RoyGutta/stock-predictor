import { useCallback, useEffect, useState } from "react";

import {
  asArrayOf,
  asString,
  readStored,
  storageKey,
  writeStored,
} from "../../lib/storage";

const KEY = storageKey("watchlist");

/** Keeping this bounded stops one enthusiastic session from making the sidebar
 *  unusable, and keeps the stored blob far inside any quota. */
export const MAX_WATCHLIST = 30;

function validate(value: unknown): string[] | null {
  const tickers = asArrayOf(value, asString);
  if (tickers === null) return null;
  // Normalize on read too: an older build may have stored mixed case, and a
  // duplicate under a different case would render twice with the same key.
  const seen = new Set<string>();
  return tickers
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => ticker && !seen.has(ticker) && (seen.add(ticker), true))
    .slice(0, MAX_WATCHLIST);
}

export interface Watchlist {
  tickers: string[];
  has: (ticker: string) => boolean;
  toggle: (ticker: string) => void;
  remove: (ticker: string) => void;
  clear: () => void;
  /** True once the cap is reached, so callers can explain a refused add. */
  isFull: boolean;
}

/**
 * The watchlist, persisted locally.
 *
 * Local rather than server-side on purpose: there is no account system, and
 * inventing one to store a list of ticker symbols would be a large amount of
 * security surface for very little. The tradeoff — the list does not follow
 * the user to another device — is stated in the UI rather than hidden.
 */
export function useWatchlist(): Watchlist {
  const [tickers, setTickers] = useState<string[]>(() => readStored(KEY, validate, []));

  useEffect(() => {
    writeStored(KEY, tickers);
  }, [tickers]);

  const toggle = useCallback((raw: string) => {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) return;
    setTickers((current) =>
      current.includes(ticker)
        ? current.filter((entry) => entry !== ticker)
        : // Newest first: the thing just added is the thing being looked at.
          [ticker, ...current].slice(0, MAX_WATCHLIST),
    );
  }, []);

  const remove = useCallback((raw: string) => {
    const ticker = raw.trim().toUpperCase();
    setTickers((current) => current.filter((entry) => entry !== ticker));
  }, []);

  const clear = useCallback(() => setTickers([]), []);

  const has = useCallback(
    (raw: string) => tickers.includes(raw.trim().toUpperCase()),
    [tickers],
  );

  return { tickers, has, toggle, remove, clear, isFull: tickers.length >= MAX_WATCHLIST };
}
