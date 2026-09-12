import { useMemo, useState } from "react";

import { Button, Card } from "../components/ui";
import { ToolGuide } from "../features/education/ToolGuide";
import { CapabilityNotice, MoversPanel, SectorsPanel } from "../features/market/MarketPanels";
import { SearchBox } from "../features/search/SearchBox";
import { WatchlistPanel } from "../features/watchlist/WatchlistPanel";
import { useWatchlist } from "../features/watchlist/useWatchlist";
import { useWatchlistQuotes } from "../features/watchlist/useWatchlistQuotes";
import { Link } from "../app/router";
import { useNavigate } from "../app/routes";
import {
  useCapabilities,
  useMomentumRanking,
  useMovers,
  useSectors,
} from "../hooks/useMarketData";

const EXAMPLE_TICKERS = ["AAPL", "MSFT", "VOO", "NVDA"];

/**
 * The landing page: what this application is, what it is not, and live market
 * context. Every path from here leads into a tool rather than a verdict.
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const [tickerInput, setTickerInput] = useState("");

  const capabilities = useCapabilities();
  const canShowMovers = capabilities.data?.movers ?? false;
  const canShowSectors = capabilities.data?.sectors ?? false;

  const movers = useMovers(canShowMovers);
  const sectors = useSectors(canShowSectors);

  const watchlist = useWatchlist();
  const watchlistQuotes = useWatchlistQuotes(watchlist.tickers);
  const watchlistMomentum = useMomentumRanking(watchlist.tickers, "1Y");
  const [sortByMomentum, setSortByMomentum] = useState(false);
  const momentumByTicker = useMemo(
    () => new Map((watchlistMomentum.data?.tickers ?? []).map((row) => [row.ticker, row])),
    [watchlistMomentum.data],
  );

  const openTicker = (symbol: string) => navigate("analyze", symbol);

  return (
    <div className="page">
      <div className="app__grid">
        <div className="app__primary">
          <Card>
            <div className="welcome">
              <h1 className="welcome__title">
                Understand what market history actually shows
              </h1>
              <p className="welcome__body">
                This application helps you explore historical market data, risk,
                diversification, and investing concepts using real prices and transparent
                methods. It does not predict future prices and does not provide
                individualized financial advice.
              </p>
              <div style={{ width: "100%", maxWidth: "34rem" }}>
                <SearchBox
                  value={tickerInput}
                  onChange={setTickerInput}
                  onSubmit={openTicker}
                  loading={false}
                  suggestionsEnabled={capabilities.data?.search ?? false}
                />
              </div>
              <div className="welcome__examples">
                {EXAMPLE_TICKERS.map((symbol) => (
                  <Button key={symbol} small onClick={() => openTicker(symbol)}>
                    {symbol}
                  </Button>
                ))}
              </div>
              <p className="welcome__links">
                New to investing? Start with <Link to="learn">Learn</Link>, try the{" "}
                <Link to="portfolio">portfolio replay</Link>, or{" "}
                <Link to="compare">compare securities</Link> side by side.
              </p>
            </div>
          </Card>

          <ToolGuide />

          {canShowMovers ? (
            <MoversPanel
              data={movers.data}
              loading={movers.loading}
              error={movers.error}
              onSelect={openTicker}
            />
          ) : (
            capabilities.data && (
              <CapabilityNotice
                title="Biggest movers"
                note={capabilities.data.notes.movers ?? "Movers are not configured."}
              />
            )
          )}

          {canShowSectors && (
            <SectorsPanel
              sectors={sectors.data}
              loading={sectors.loading}
              error={sectors.error}
            />
          )}
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
            onSelect={openTicker}
            onRemove={watchlist.remove}
            onClear={watchlist.clear}
            onRefresh={watchlistQuotes.refresh}
          />
        </div>
      </div>
    </div>
  );
}
