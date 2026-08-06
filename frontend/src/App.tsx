import { useCallback, useEffect, useState } from "react";

import { Button, Callout, Card } from "./components/ui";
import { EvidenceLedger } from "./features/analysis/EvidenceLedger";
import { RiskPanel } from "./features/analysis/RiskPanel";
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
import { SearchBox } from "./features/search/SearchBox";
import {
  useCapabilities,
  useMarketStatus,
  useMovers,
  useNews,
  useSectors,
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

  const capabilities = useCapabilities();
  const marketStatus = useMarketStatus();
  const canShowMovers = capabilities.data?.movers ?? false;
  const canShowSectors = capabilities.data?.sectors ?? false;
  const canShowNews = capabilities.data?.news ?? false;

  const movers = useMovers(canShowMovers);
  const sectors = useSectors(canShowSectors);
  const news = useNews(quote?.ticker ?? null, canShowNews);

  // Keep the recent list in sync with whatever loaded last, most recent first.
  useEffect(() => {
    if (!quote) return;
    setRecent((previous) =>
      [quote, ...previous.filter((item) => item.ticker !== quote.ticker)].slice(0, MAX_RECENT),
    );
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
                {quote && !error && <QuoteSummary quote={quote} />}
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
            </div>

            <div className="app__side">
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
