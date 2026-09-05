import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Callout, Card } from "../components/ui";
import { EvidenceLedger } from "../features/analysis/EvidenceLedger";
import { RiskPanel } from "../features/analysis/RiskPanel";
import { BacktestPanel } from "../features/backtest/BacktestPanel";
import { ChartControls } from "../features/chart/ChartControls";
import { LazyPriceChart } from "../features/chart/LazyPriceChart";
import { DEFAULT_CHART_OPTIONS, type ChartOptions } from "../features/chart/chartConfig";
import { CapabilityNotice, NewsPanel } from "../features/market/MarketPanels";
import { MomentumPanel } from "../features/momentum/MomentumPanel";
import { PatternsPanel } from "../features/patterns/PatternsPanel";
import { ProfilePanel } from "../features/profile/ProfilePanel";
import {
  QuoteSkeleton,
  QuoteSummary,
  RangeSelector,
  RecentSearches,
} from "../features/quote/QuotePanel";
import { useRecentSearches } from "../features/quote/useRecentSearches";
import { SearchBox } from "../features/search/SearchBox";
import { SimulationPanel } from "../features/simulation/SimulationPanel";
import { WatchlistPanel } from "../features/watchlist/WatchlistPanel";
import { useWatchlist } from "../features/watchlist/useWatchlist";
import { useWatchlistQuotes } from "../features/watchlist/useWatchlistQuotes";
import { useNavigate, useRoute } from "../app/routes";
import {
  useBacktest,
  useCapabilities,
  useMomentumRanking,
  useNews,
  usePatterns,
  useProfile,
  useSimulation,
} from "../hooks/useMarketData";
import { useTickerData } from "../hooks/useTickerData";
import { buildHistoryCsv, downloadCsv } from "../lib/export";
import type { Range } from "../types/market";

const EXAMPLE_TICKERS = ["AAPL", "MSFT", "VOO", "NVDA"];

/**
 * Security detail. The route parameter (#/analyze/AAPL) is the source of
 * truth for which ticker is loaded, so deep links, back/forward, and refresh
 * all land on the same analysis.
 */
export function AnalyzePage() {
  const { param } = useRoute();
  const navigate = useNavigate();
  const { quote, analysis, loading, error, analysisError, load } = useTickerData();

  const [tickerInput, setTickerInput] = useState(param ?? "");
  const [range, setRange] = useState<Range>("1Y");
  const [options, setOptions] = useState<ChartOptions>(DEFAULT_CHART_OPTIONS);
  const recent = useRecentSearches();
  // Backtesting, simulation, and pattern scans are all opt-in: they are the
  // most expensive requests in the app and most visits do not need them.
  const [backtestFor, setBacktestFor] = useState<string | null>(null);
  const [simulationFor, setSimulationFor] = useState<string | null>(null);
  const [patternsFor, setPatternsFor] = useState<string | null>(null);

  const watchlist = useWatchlist();
  const watchlistQuotes = useWatchlistQuotes(watchlist.tickers);
  // Momentum needs enough bars to fill a 100-period average, so it is read over
  // 1Y regardless of the chart range the user is looking at.
  const watchlistMomentum = useMomentumRanking(watchlist.tickers, "1Y");
  const [sortByMomentum, setSortByMomentum] = useState(false);
  const momentumByTicker = useMemo(
    () => new Map((watchlistMomentum.data?.tickers ?? []).map((row) => [row.ticker, row])),
    [watchlistMomentum.data],
  );

  const capabilities = useCapabilities();
  const canShowNews = capabilities.data?.news ?? false;
  const canShowProfile = capabilities.data?.fundamentals ?? false;

  const news = useNews(quote?.ticker ?? null, canShowNews);
  const profile = useProfile(quote?.ticker ?? null, canShowProfile);
  const backtest = useBacktest(backtestFor, range);
  const simulation = useSimulation(simulationFor, range);
  const patterns = usePatterns(patternsFor, range);

  // The URL drives the data. Range and period intentionally stay out of the
  // dependency list: changing them re-loads through their own handlers, and
  // re-running this effect on those changes would double-fetch.
  useEffect(() => {
    if (param) {
      setTickerInput(param);
      load(param, range, options.period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, load]);

  const recordRecent = recent.record;
  useEffect(() => {
    if (!quote) return;
    // Only successful lookups enter the history — a typo that 404s never does.
    recordRecent(quote.ticker, quote.company_name);
    // These results belong to one ticker; looking up another must not leave a
    // previous result on screen under the new name.
    setBacktestFor((current) => (current === quote.ticker ? current : null));
    setSimulationFor((current) => (current === quote.ticker ? current : null));
    setPatternsFor((current) => (current === quote.ticker ? current : null));
  }, [quote, recordRecent]);

  const selectTicker = useCallback(
    (symbol: string) => {
      const normalized = symbol.trim().toUpperCase();
      if (!normalized) return;
      if (normalized === param) {
        // Same URL produces no hashchange; reload directly.
        load(normalized, range, options.period);
      } else {
        navigate("analyze", normalized);
      }
    },
    [param, navigate, load, range, options.period],
  );

  const handleRangeChange = useCallback(
    (next: Range) => {
      setRange(next);
      if (quote) load(quote.ticker, next, options.period);
    },
    [quote, load, options.period],
  );

  const handleOptionsChange = useCallback(
    (next: ChartOptions) => {
      setOptions(next);
      // Indicator series are computed server-side, so a new window needs a refetch.
      // Everything else is a pure display toggle and must not hit the network.
      if (quote && next.period !== options.period) load(quote.ticker, range, next.period);
    },
    [quote, options.period, range, load],
  );

  const handleExportCsv = useCallback(() => {
    if (!quote) return;
    downloadCsv(
      `${quote.ticker}-${quote.range}.csv`,
      buildHistoryCsv(quote.history, analysis?.series ?? null),
    );
  }, [quote, analysis]);

  const showEmpty = !param && !quote && !loading && !error;

  return (
    <div className="page">
      <div className="app__toolbar">
        <SearchBox
          value={tickerInput}
          onChange={setTickerInput}
          onSubmit={selectTicker}
          loading={loading}
          suggestionsEnabled={capabilities.data?.search ?? false}
        />
        <RangeSelector value={range} onChange={handleRangeChange} disabled={loading} />
      </div>

      <div className="app__grid">
        <div className="app__primary">
          <div aria-live="polite" aria-atomic="true">
            {error && (
              <Callout tone="error" role="alert">
                {error}
              </Callout>
            )}
            {loading && !quote && <QuoteSkeleton />}
            {quote && !error && (
              <QuoteSummary
                quote={quote}
                watched={watchlist.has(quote.ticker)}
                onToggleWatch={() => watchlist.toggle(quote.ticker)}
              />
            )}
          </div>

          {showEmpty && (
            <Card>
              <div className="welcome">
                <h1 className="welcome__title">Analyze a security</h1>
                <p className="welcome__body">
                  Search for any listed ticker to see its real price history, standard
                  technical indicators, risk statistics, and what the evidence does and
                  does not show.
                </p>
                <div className="welcome__examples">
                  {EXAMPLE_TICKERS.map((symbol) => (
                    <Button key={symbol} small onClick={() => selectTicker(symbol)}>
                      {symbol}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {quote && !error && (
            <Card
              title="Price history"
              action={
                <Button variant="ghost" small onClick={handleExportCsv}>
                  Export CSV
                </Button>
              }
            >
              <LazyPriceChart
                candles={quote.history}
                series={analysis?.series ?? null}
                range={quote.range}
                ticker={quote.ticker}
                currency={quote.currency}
                options={options}
              />
              <ChartControls options={options} onChange={handleOptionsChange} />
            </Card>
          )}

          {analysisError && quote && (
            <Callout tone="note">
              The chart loaded, but the analysis did not: {analysisError}
            </Callout>
          )}

          {quote && !error && canShowProfile && (
            <ProfilePanel
              profile={profile.data}
              loading={profile.loading}
              error={profile.error}
              ticker={quote.ticker}
            />
          )}

          {analysis?.momentum && quote && (
            <MomentumPanel momentum={analysis.momentum} ticker={quote.ticker} />
          )}

          {analysis && !analysisError && (
            <EvidenceLedger interpretation={analysis.interpretation} />
          )}

          {analysis?.risk && <RiskPanel risk={analysis.risk} />}

          {analysis && !analysis.risk && (
            <Callout tone="note">
              This range has too few trading days to calculate risk statistics that would
              mean anything. Try a longer range.
            </Callout>
          )}

          {analysis?.risk && (
            <SimulationPanel
              data={simulation.data}
              loading={simulation.loading}
              error={simulation.error}
              ticker={quote?.ticker ?? ""}
              currency={quote?.currency ?? "USD"}
              started={simulationFor === quote?.ticker}
              onRun={() => quote && setSimulationFor(quote.ticker)}
            />
          )}

          {quote && !error && (
            <BacktestPanel
              data={backtest.data}
              loading={backtest.loading}
              error={backtest.error}
              ticker={quote.ticker}
              started={backtestFor === quote.ticker}
              onRun={() => setBacktestFor(quote.ticker)}
            />
          )}

          {quote && !error && (
            <PatternsPanel
              data={patterns.data}
              loading={patterns.loading}
              error={patterns.error}
              ticker={quote.ticker}
              started={patternsFor === quote.ticker}
              onRun={() => setPatternsFor(quote.ticker)}
            />
          )}

          {quote &&
            (canShowNews ? (
              <NewsPanel
                news={news.data}
                loading={news.loading}
                error={news.error}
                ticker={quote.ticker}
              />
            ) : (
              capabilities.data && (
                <CapabilityNotice
                  title="News"
                  note={capabilities.data.notes.news ?? "News is not configured."}
                />
              )
            ))}
        </div>

        <div className="app__side">
          <WatchlistPanel
            rows={watchlistQuotes.rows}
            loading={watchlistQuotes.loading}
            updatedAt={watchlistQuotes.updatedAt}
            tickers={watchlist.tickers}
            momentum={momentumByTicker}
            sortByMomentum={sortByMomentum}
            onToggleSort={() => setSortByMomentum((value) => !value)}
            onSelect={selectTicker}
            onRemove={watchlist.remove}
            onClear={watchlist.clear}
            onRefresh={watchlistQuotes.refresh}
          />
          <RecentSearches
            entries={recent.entries}
            onSelect={selectTicker}
            onClear={recent.clear}
          />
        </div>
      </div>
    </div>
  );
}
