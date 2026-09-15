import { Button, Card, Skeleton, Stat } from "../../components/ui";
import {
  formatChange,
  formatPercent,
  formatPrice,
  formatTimestamp,
  formatVolume,
} from "../../lib/format";
import { INTRADAY_RANGES, RANGES, RANGE_LABELS, type Quote, type Range } from "../../types/market";
import type { RecentSearch } from "./useRecentSearches";
import "./quote.css";

// --- range selector --------------------------------------------------------

interface RangeSelectorProps {
  value: Range;
  onChange: (range: Range) => void;
  disabled?: boolean;
}

export function RangeSelector({ value, onChange, disabled = false }: RangeSelectorProps) {
  return (
    <div className="ranges" role="group" aria-label="Chart range">
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          className="ranges__option"
          aria-pressed={value === range}
          // WCAG 2.5.3: the visible text must appear inside the accessible name.
          aria-label={`${range}, ${RANGE_LABELS[range]}`}
          disabled={disabled}
          onClick={() => onChange(range)}
        >
          {range}
        </button>
      ))}
    </div>
  );
}

// --- quote summary ---------------------------------------------------------

interface QuoteSummaryProps {
  quote: Quote;
  watched: boolean;
  onToggleWatch: () => void;
}

export function QuoteSummary({ quote, watched, onToggleWatch }: QuoteSummaryProps) {
  const positive = quote.change_points >= 0;
  const intraday = INTRADAY_RANGES.has(quote.range);

  return (
    <Card>
      <div className="quote">
        <div className="quote__identity">
          <h1 className="quote__ticker">{quote.ticker}</h1>
          <p className="quote__company">{quote.company_name}</p>
          <Button
            variant={watched ? "default" : "ghost"}
            small
            onClick={onToggleWatch}
            aria-pressed={watched}
            className="quote__watch"
          >
            <span aria-hidden="true">{watched ? "★" : "☆"}</span>
            {watched ? "Watching" : "Watch"}
          </Button>
        </div>

        <div className="quote__price-row">
          <span className="quote__price">{formatPrice(quote.price, quote.currency)}</span>
          <span className={`quote__change quote__change--${positive ? "positive" : "negative"}`}>
            {/* The glyph carries the direction too, so meaning never rests on color alone. */}
            <span aria-hidden="true">{positive ? "▲" : "▼"}</span>
            {formatChange(quote.change_points)} ({formatPercent(quote.change_percent / 100)})
            <span className="visually-hidden">
              {positive ? "up" : "down"} over {RANGE_LABELS[quote.range]}
            </span>
          </span>
        </div>

        <div className="quote__figures">
          <Stat label="Open" value={formatPrice(quote.open, quote.currency)} />
          <Stat label="High" value={formatPrice(quote.high, quote.currency)} />
          <Stat label="Low" value={formatPrice(quote.low, quote.currency)} />
          <Stat label="Volume" value={formatVolume(quote.volume)} term="volume" />
        </div>

        <p className="quote__meta">
          As of {formatTimestamp(quote.as_of, intraday)} · data from {quote.source} ·{" "}
          {quote.source.toLowerCase().includes("demo")
            ? "synthetic, not live market data"
            : "delayed and for education only"}
        </p>
      </div>
    </Card>
  );
}

export function QuoteSkeleton() {
  return (
    <Card>
      <div className="quote">
        <Skeleton height={28} width="14rem" />
        <Skeleton height={40} width="18rem" />
        <div className="quote__figures">
          {["open", "high", "low", "volume"].map((key) => (
            <Skeleton key={key} height={36} />
          ))}
        </div>
      </div>
    </Card>
  );
}

// --- recent searches -------------------------------------------------------

interface RecentSearchesProps {
  entries: RecentSearch[];
  onSelect: (ticker: string) => void;
  onClear: () => void;
}

/**
 * Persisted navigation history. Deliberately shows no price or change: these
 * entries can be days old, and a number from a previous visit rendered without
 * a timestamp would be stale market data presented as current. Live figures
 * belong to the watchlist, which refetches them.
 */
export function RecentSearches({ entries, onSelect, onClear }: RecentSearchesProps) {
  return (
    <Card
      title="Recent"
      as="aside"
      action={
        entries.length > 0 ? (
          <Button variant="ghost" small onClick={onClear}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
          Tickers you look up will appear here, and stay here across visits.
        </p>
      ) : (
        <ul className="recent">
          {entries.map((entry) => (
            <li key={entry.ticker}>
              <button
                type="button"
                className="recent__button"
                onClick={() => onSelect(entry.ticker)}
              >
                <span className="recent__ticker">{entry.ticker}</span>
                <span className="recent__company">{entry.company_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
