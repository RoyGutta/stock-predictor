import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { formatPercent, formatPrice, formatTimestamp } from "../../lib/format";
import { WATCHLIST_RANGE_LABEL, type WatchlistRow } from "./useWatchlistQuotes";
import "./watchlist.css";

interface WatchlistPanelProps {
  rows: WatchlistRow[];
  loading: boolean;
  updatedAt: Date | null;
  tickers: string[];
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onClear: () => void;
  onRefresh: () => void;
}

function Row({
  row,
  onSelect,
  onRemove,
}: {
  row: WatchlistRow;
  onSelect: (ticker: string) => void;
  onRemove: (ticker: string) => void;
}) {
  const { ticker, quote, error } = row;
  const change = quote?.change_percent ?? null;
  // Exact zero is neither a gain nor a loss (LEARNINGS L-8).
  const direction = change === null || change === 0 ? "flat" : change > 0 ? "up" : "down";

  return (
    <li className="wl-row">
      <button
        type="button"
        className="wl-row__main"
        onClick={() => onSelect(ticker)}
        aria-label={`Open ${ticker}`}
      >
        <span className="wl-row__identity">
          <span className="wl-row__ticker">{ticker}</span>
          <span className="wl-row__name">
            {error ? <span className="wl-row__error">{error}</span> : quote?.company_name}
          </span>
        </span>

        {quote && (
          <>
            <span className="wl-row__price numeric">
              {formatPrice(quote.price, quote.currency)}
            </span>
            <span className={`wl-row__change wl-row__change--${direction} numeric`}>
              <span aria-hidden="true">
                {direction === "up" ? "▲" : direction === "down" ? "▼" : "■"}
              </span>{" "}
              {formatPercent(change === null ? null : change / 100)}
              {/* The figure is a month's move, not today's. Unlabelled it reads
                  as a daily change, which for a large stock is implausible and
                  alarming. Sighted users get the column label; this is the
                  same fact for anyone reading row by row. */}
              <span className="visually-hidden"> over 1 month</span>
            </span>
          </>
        )}
      </button>

      <button
        type="button"
        className="wl-row__remove"
        onClick={() => onRemove(ticker)}
        aria-label={`Remove ${ticker} from watchlist`}
        title={`Remove ${ticker}`}
      >
        ×
      </button>
    </li>
  );
}

/**
 * The watchlist.
 *
 * A ticker that fails to load keeps its row and shows the reason. Dropping the
 * row would read as "your watchlist entry was deleted", which is a worse
 * outcome than an inline error on a list the user curated by hand.
 */
export function WatchlistPanel({
  rows,
  loading,
  updatedAt,
  tickers,
  onSelect,
  onRemove,
  onClear,
  onRefresh,
}: WatchlistPanelProps) {
  const empty = tickers.length === 0;

  return (
    <Card
      title="Watchlist"
      as="aside"
      action={
        empty ? undefined : (
          <div className="wl-actions">
            <Button variant="ghost" small onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="ghost" small onClick={onClear}>
              Clear
            </Button>
          </div>
        )
      }
    >
      {empty ? (
        <p className="wl-empty">
          Nothing here yet. Open a stock and press <strong>Watch</strong> to keep an eye on
          it.
        </p>
      ) : (
        <>
          <p className="wl-column-note eyebrow">{WATCHLIST_RANGE_LABEL}</p>
          <ul className="wl-list">
            {loading && rows.length === 0
              ? tickers.map((ticker) => <Skeleton key={ticker} height={44} />)
              : rows.map((row) => (
                  <Row key={row.ticker} row={row} onSelect={onSelect} onRemove={onRemove} />
                ))}
          </ul>

          {updatedAt && (
            <p className="wl-meta">
              Updated {formatTimestamp(updatedAt.toISOString(), true)} · prices may be
              delayed and are shown for education only
            </p>
          )}
        </>
      )}

      {tickers.length > 0 && (
        <Callout tone="note">
          Saved in this browser only. Clearing site data or opening the app elsewhere will
          not carry it over.
        </Callout>
      )}
    </Card>
  );
}
