import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Callout, Card } from "./components/ui";
import { EvidenceLedger } from "./features/analysis/EvidenceLedger";
import { RiskPanel } from "./features/analysis/RiskPanel";
import { BacktestPanel } from "./features/backtest/BacktestPanel";
import { ChartControls } from "./features/chart/ChartControls";
import { LazyPriceChart } from "./features/chart/LazyPriceChart";
import { DEFAULT_CHART_OPTIONS, type ChartOptions } from "./features/chart/chartConfig";
import { LearnPanel } from "./features/education/LearnPanel";
import {
  CapabilityNotice,
  MoversPanel,
  NewsPanel,
  SectorsPanel,
  SessionBadge,
} from "./features/market/MarketPanels";
import {
  QuoteSkeleton,
  QuoteSummary,
  RangeSelector,
  RecentSearches,
} from "./features/quote/QuotePanel";
import { MomentumPanel } from "./features/momentum/MomentumPanel";
import { PortfolioBuilder } from "./features/portfolio/PortfolioBuilder";
import { ProfilePanel } from "./features/profile/ProfilePanel";
import { SearchBox } from "./features/search/SearchBox";
import { SimulationPanel } from "./features/simulation/SimulationPanel";
import { WatchlistPanel } from "./features/watchlist/WatchlistPanel";
import { useWatchlist } from "./features/watchlist/useWatchlist";
import { useWatchlistQuotes } from "./features/watchlist/useWatchlistQuotes";
import {
  useCapabilities,
  useMarketStatus,
  useBacktest,
  useMovers,
  useNews,
  useMomentumRanking,
  useProfile,
  useSectors,
  useSimulation,
} from "./hooks/useMarketData";
import { useTheme } from "./hooks/useTheme";
import { useTickerData } from "./hooks/useTickerData";
import { buildHistoryCsv, downloadCsv } from "./lib/export";
import type { Quote, Range } from "./types/market";
import "./App.css";

const EXAMPLE_TICKERS = ["AAPL", "MSFT", "VOO", "NVDA"];
const MAX_RECENT = 8;

function App() {
  const { theme, toggleTheme } = useTheme();
  const { quote, analysis, loading, error, analysisError, load } = useTickerData();

  const [tickerInput, setTickerInput] = useState("");
  const [range, setRange] = useState<Range>("1Y");
  const [options, setOptions] = useState<ChartOptions>(DEFAULT_CHART_OPTIONS);
  const [recent, setRecent] = useState<Quote[]>([]);
  // Backtesting and simulation are both opt-in: they are the most expensive
  // requests in the app and most visits do not need either.
  const [backtestFor, setBacktestFor] = useState<string | null>(null);
  const [simulationFor, setSimulationFor] = useState<string | null>(null);

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
  const marketStatus = useMarketStatus();
  const canShowMovers = capabilities.data?.movers ?? false;
  const canShowSectors = capabilities.data?.sectors ?? false;
  const canShowNews = capabilities.data?.news ?? false;
  const canShowProfile = capabilities.data?.fundamentals ?? false;

  const movers = useMovers(canShowMovers);
  const sectors = useSectors(canShowSectors);
  const news = useNews(quote?.ticker ?? null, canShowNews);
  const profile = useProfile(quote?.ticker ?? null, canShowProfile);
  const backtest = useBacktest(backtestFor, range);
  const simulation = useSimulation(simulationFor, range);

  // Keep the recent list in sync with whatever loaded last, most recent first.
  useEffect(() => {
    if (!quote) return;
    setRecent((previous) =>
      [quote, ...previous.filter((item) => item.ticker !== quote.ticker)].slice(0, MAX_RECENT),
    );
    // These results belong to one ticker; looking up another must not leave a
    // previous result on screen under the new name.
    setBacktestFor((current) => (current === quote.ticker ? current : null));
    setSimulationFor((current) => (current === quote.ticker ? current : null));
  }, [quote]);

  const search = useCallback(
    (symbol: string, nextRange = range, nextPeriod = options.period) => {
      load(symbol, nextRange, nextPeriod);
    },
    [load, range, options.period],
  );

  const selectTicker = useCallback(
    (symbol: string) => {
      setTickerInput(symbol);
      search(symbol);
    },
    [search],
  );

  const handleRangeChange = useCallback(
    (next: Range) => {
      setRange(next);
      if (quote) search(quote.ticker, next);
    },
    [quote, search],
  );

  const handleOptionsChange = useCallback(
    (next: ChartOptions) => {
      setOptions(next);
      // Indicator series are computed server-side, so a new window needs a refetch.
      // Everything else is a pure display toggle and must not hit the network.
      if (quote && next.period !== options.period) search(quote.ticker, range, next.period);
    },
    [quote, options.period, range, search],
  );

  const handleExportCsv = useCallback(() => {
    if (!quote) return;
    downloadCsv(
      `${quote.ticker}-${quote.range}.csv`,
      buildHistoryCsv(quote.history, analysis?.series ?? null),
    );
  }, [quote, analysis]);

  const showWelcome = !quote && !loading && !error;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="app">
        <header className="app__bar">
          <div className="app__brand">
            <span className="app__mark" aria-hidden="true" />
            <span className="app__name">Stock Predictor</span>
            <span className="app__tag">Educational market analysis</span>
          </div>
          <div className="app__bar-right">
            {marketStatus.data && <SessionBadge status={marketStatus.data} />}
            <Button variant="ghost" small onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"} mode
            </Button>
          </div>
        </header>

        <main id="main" className="app__main">
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

              {showWelcome && (
                <Card>
                  <div className="welcome">
                    <h1 className="welcome__title">
                      Look up any stock and find out what its history actually shows
                    </h1>
                    <p className="welcome__body">
                      Real market data and standard technical indicators, with plain-English
                      explanations of what each one measures — and where it stops being useful.
                      No predictions, no buy or sell calls.
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

              {showWelcome &&
                (canShowMovers ? (
                  <MoversPanel
                    data={movers.data}
                    loading={movers.loading}
                    error={movers.error}
                    onSelect={selectTicker}
                  />
                ) : (
                  capabilities.data && (
                    <CapabilityNotice
                      title="Biggest movers"
                      note={capabilities.data.notes.movers ?? "Movers are not configured."}
                    />
                  )
                ))}

              {showWelcome && canShowSectors && (
                <SectorsPanel
                  sectors={sectors.data}
                  loading={sectors.loading}
                  error={sectors.error}
                />
              )}

              <PortfolioBuilder />
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
                quotes={recent}
                onSelect={selectTicker}
                onClear={() => setRecent([])}
              />
              <LearnPanel />
            </div>
          </div>
        </main>

        <footer className="app__footer">
          <p>
            Educational tool. Not investment advice. Market data may be delayed or incomplete,
            and every figure shown describes the past — none of it predicts what happens next.
            Investing involves risk, including loss of principal.
          </p>
        </footer>
      </div>
    </>
  );
}

export default App;
