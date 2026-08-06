import { useEffect, useRef, useState } from "react";

import { isAbort, searchTickers } from "../lib/api";
import type { SearchResult } from "../types/market";

/** Wait this long after the last keystroke before querying. */
const DEBOUNCE_MS = 220;
const MIN_QUERY_LENGTH = 1;

/**
 * Debounced ticker autocomplete.
 *
 * Debouncing is not just a nicety here: the free provider tier allows 60 calls
 * a minute, and a request per keystroke would exhaust that while someone types
 * a single company name.
 */
export function useTickerSearch(query: string, enabled: boolean) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      inFlight.current?.abort();
      setResults([]);
      setLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setLoading(true);

      searchTickers(trimmed, 8, controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) {
            setResults(found);
            setLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (isAbort(error) || controller.signal.aborted) return;
          // A failed lookup should not block typing; fall back to no suggestions.
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, enabled]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { results, loading };
}
