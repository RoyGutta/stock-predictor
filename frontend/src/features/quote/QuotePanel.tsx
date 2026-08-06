import { useId, type FormEvent } from "react";

import { Button, Card, Skeleton, Stat } from "../../components/ui";
import {
  formatChange,
  formatPercent,
  formatPrice,
  formatTimestamp,
  formatVolume,
} from "../../lib/format";
import { INTRADAY_RANGES, RANGES, RANGE_LABELS, type Quote, type Range } from "../../types/market";
import "./quote.css";

// --- search ----------------------------------------------------------------

interface TickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function TickerSearch({ value, onChange, onSubmit, loading }: TickerSearchProps) {
  const inputId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="search" onSubmit={handleSubmit} role="search">
      <label className="visually-hidden" htmlFor={inputId}>
        Stock ticker symbol
      </label>
      <input
        id={inputId}
        className="search__field"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Enter a ticker — AAPL, MSFT, VOO"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <Button variant="primary" type="submit" disabled={loading || !value.trim()}>
        {loading ? "Loading…" : "Analyze"}
      </Button>
    </form>
  );
}

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
          aria-label={RANGE_LABELS[range]}
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

export function QuoteSummary({ quote }: { quote: Quote }) {
  const positive = quote.change_points >= 0;
  const intraday = INTRADAY_RANGES.has(quote.range);

  return (
    <Card>
      <div className="quote">
        <div className="quote__identity">
          <h1 className="quote__ticker">{quote.ticker}</h1>
          <p className="quote__company">{quote.company_name}</p>
        </div>

        <div className="quote__price-row">
          <span className="quote__price">{formatPrice(quote.price, quote.currency)}</span>
          <span className={`quote__change quote__change--${positive ? "positive" : "negative"}`}>
            {/* The glyph carries the direction too, so meaning never rests on colour alone. */}
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
          As of {formatTimestamp(quote.as_of, intraday)} · data from {quote.source} · delayed and
          for education only
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
  quotes: Quote[];
  onSelect: (ticker: string) => void;
  onClear: () => void;
}

export function RecentSearches({ quotes, onSelect, onClear }: RecentSearchesProps) {
  return (
    <Card
      title="Recent"
      as="aside"
      action={
        quotes.length > 0 ? (
          <Button variant="ghost" small onClick={onClear}>
            Clear
          </Button>
        ) : undefined
      }
    >
      {quotes.length === 0 ? (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
          Tickers you look up will appear here.
        </p>
      ) : (
        <ul className="recent">
          {quotes.map((quote) => {
            const positive = quote.change_points >= 0;
            return (
              <li key={quote.ticker}>
                <button
                  type="button"
                  className="recent__button"
                  onClick={() => onSelect(quote.ticker)}
                >
                  <span className="recent__top">
                    <span className="recent__ticker">{quote.ticker}</span>
                    <span
                      className="recent__change"
                      style={{ color: positive ? "var(--up)" : "var(--down)" }}
                    >
                      <span aria-hidden="true">{positive ? "▲" : "▼"}</span>{" "}
                      {formatPercent(quote.change_percent / 100)}
                    </span>
                  </span>
                  <span className="recent__company">{quote.company_name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
