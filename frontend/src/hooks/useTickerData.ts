import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, fetchAnalysis, fetchQuote, isAbort } from "../lib/api";
import type { Analysis, Quote, Range } from "../types/market";

export interface TickerData {
  quote: Quote | null;
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  /** Analysis can fail while the quote succeeds; the chart still renders. */
  analysisError: string | null;
  load: (ticker: string, range: Range, period: number) => void;
  reset: () => void;
}

function toMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong.";
}

/**
 * Loads a ticker's quote and analysis together.
 *
 * The two requests run in parallel but are treated asymmetrically: the quote is
 * essential, the analysis is enrichment. If only the analysis fails the chart
 * still renders, with the interpretation panel showing why it is missing.
 */
export function useTickerData(): TickerData {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Supersedes in-flight work, so a slow response for an earlier ticker can
  // never overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const load = useCallback((ticker: string, range: Range, period: number) => {
    const symbol = ticker.trim().toUpperCase();
    if (!symbol) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);
    setAnalysisError(null);

    void (async () => {
      const [quoteResult, analysisResult] = await Promise.allSettled([
        fetchQuote(symbol, range, controller.signal),
        fetchAnalysis(symbol, range, period, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (quoteResult.status === "fulfilled") {
        setQuote(quoteResult.value);
      } else if (!isAbort(quoteResult.reason)) {
        setQuote(null);
        setAnalysis(null);
        setError(toMessage(quoteResult.reason));
        setLoading(false);
        return;
      }

      if (analysisResult.status === "fulfilled") {
        setAnalysis(analysisResult.value);
      } else if (!isAbort(analysisResult.reason)) {
        setAnalysis(null);
        setAnalysisError(toMessage(analysisResult.reason));
      }

      setLoading(false);
    })();
  }, []);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    setQuote(null);
    setAnalysis(null);
    setError(null);
    setAnalysisError(null);
    setLoading(false);
  }, []);

  return { quote, analysis, loading, error, analysisError, load, reset };
}
