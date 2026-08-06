import { useState } from "react";

import { Callout, Card, Skeleton } from "../../components/ui";
import { formatPercent, formatPrice, formatTimestamp } from "../../lib/format";
import type {
  MarketStatus,
  Mover,
  MoversResponse,
  NewsResponse,
  SectorPerformance,
} from "../../types/market";
import "./market.css";

// --- session status --------------------------------------------------------

export function SessionBadge({ status }: { status: MarketStatus }) {
  const label = {
    open: "Market open",
    "pre-market": "Pre-market",
    "after-hours": "After hours",
    closed: "Market closed",
  }[status.session];

  return (
    <span className={`session session--${status.session}`} title={status.reason}>
      <span className="session__dot" aria-hidden="true" />
      {label}
      {status.session === "closed" && (
        <span style={{ color: "var(--text-subtle)" }}>
          · opens {formatTimestamp(status.next_open, true)}
        </span>
      )}
    </span>
  );
}

// --- movers ----------------------------------------------------------------

const MOVER_TABS = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "actives", label: "Most active" },
] as const;

type MoverTab = (typeof MOVER_TABS)[number]["key"];

function MoverRow({ mover, onSelect }: { mover: Mover; onSelect: (ticker: string) => void }) {
  const positive = (mover.change_percent ?? 0) >= 0;
  return (
    <li>
      <button type="button" className="movers__row" onClick={() => onSelect(mover.ticker)}>
        <span className="movers__identity">
          <span className="movers__ticker">
            {mover.ticker}
            {mover.low_priced && (
              <span
                className="movers__flag"
                title="Trades under $5. Very small companies swing sharply and are the most common targets of promotional schemes."
              >
                under $5
              </span>
            )}
          </span>
          <span className="movers__name">{mover.name}</span>
        </span>
        <span className="movers__price">{formatPrice(mover.price)}</span>
        <span
          className="movers__change"
          style={{ color: positive ? "var(--up)" : "var(--down)" }}
        >
          <span aria-hidden="true">{positive ? "▲" : "▼"}</span>{" "}
          {formatPercent((mover.change_percent ?? 0) / 100)}
        </span>
      </button>
    </li>
  );
}

interface MoversPanelProps {
  data: MoversResponse | null;
  loading: boolean;
  error: string | null;
  onSelect: (ticker: string) => void;
}

export function MoversPanel({ data, loading, error, onSelect }: MoversPanelProps) {
  const [tab, setTab] = useState<MoverTab>("gainers");

  if (error) {
    return (
      <Card title="Biggest movers">
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title="Biggest movers">
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} height={34} />
          ))}
        </div>
      </Card>
    );
  }

  const rows = data[tab];
  const listError = data.errors[tab];

  return (
    <Card title="Biggest movers" action={<span className="eyebrow">Today</span>}>
      <div className="movers__tabs" role="group" aria-label="Mover category">
        {MOVER_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className="movers__tab"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {listError ? (
        <Callout tone="note">{listError}</Callout>
      ) : rows.length === 0 ? (
        <p className="unavailable">No movers reported for this list right now.</p>
      ) : (
        <ul className="movers__list">
          {rows.map((mover) => (
            <MoverRow key={mover.ticker} mover={mover} onSelect={onSelect} />
          ))}
        </ul>
      )}

      <p className="risk__basis">{data.disclaimer}</p>
    </Card>
  );
}

// --- sector heatmap --------------------------------------------------------

/**
 * Tint strength scales with the size of the move, so the eye ranks sectors
 * without reading every number. Capped at 3% because a single outlier would
 * otherwise wash out every other tile.
 */
function sectorTint(change: number): string {
  const intensity = Math.min(Math.abs(change) / 3, 1) * 0.22;
  const base = change >= 0 ? "var(--up)" : "var(--down)";
  return `color-mix(in srgb, ${base} ${(intensity * 100).toFixed(0)}%, transparent)`;
}

interface SectorsPanelProps {
  sectors: SectorPerformance[] | null;
  loading: boolean;
  error: string | null;
}

export function SectorsPanel({ sectors, loading, error }: SectorsPanelProps) {
  if (error) {
    return (
      <Card title="Sectors today">
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !sectors) {
    return (
      <Card title="Sectors today">
        <div className="sectors">
          {[0, 1, 2, 3, 4, 5].map((tile) => (
            <Skeleton key={tile} height={62} />
          ))}
        </div>
      </Card>
    );
  }

  if (sectors.length === 0) {
    return (
      <Card title="Sectors today">
        <p className="unavailable">No sector data available for the last few sessions.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Sectors today"
      action={<span className="eyebrow">{sectors[0]?.as_of}</span>}
    >
      <div className="sectors">
        {sectors.map((sector) => (
          <div
            key={sector.sector}
            className="sector"
            style={{ background: sectorTint(sector.change_percent) }}
          >
            <span className="sector__name" title={sector.sector}>
              {sector.sector}
            </span>
            <span
              className="sector__change"
              style={{ color: sector.change_percent >= 0 ? "var(--up)" : "var(--down)" }}
            >
              <span aria-hidden="true">{sector.change_percent >= 0 ? "▲" : "▼"}</span>{" "}
              {formatPercent(sector.change_percent / 100)}
            </span>
          </div>
        ))}
      </div>
      <p className="risk__basis">
        Average change across the companies in each sector for one session. A single day
        says nothing about a sector's longer-term direction.
      </p>
    </Card>
  );
}

// --- news ------------------------------------------------------------------

interface NewsPanelProps {
  news: NewsResponse | null;
  loading: boolean;
  error: string | null;
  ticker: string;
}

export function NewsPanel({ news, loading, error, ticker }: NewsPanelProps) {
  if (error) {
    return (
      <Card title={`News — ${ticker}`}>
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !news) {
    return (
      <Card title={`News — ${ticker}`}>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={40} />
          ))}
        </div>
      </Card>
    );
  }

  if (news.articles.length === 0) {
    return (
      <Card title={`News — ${ticker}`}>
        <p className="unavailable">No recent articles for {ticker}.</p>
      </Card>
    );
  }

  return (
    <Card title={`News — ${ticker}`} action={<span className="eyebrow">{news.source}</span>}>
      <ul className="news">
        {news.articles.map((article) => (
          <li key={article.url} className="news__item">
            <a
              className="news__link"
              href={article.url}
              target="_blank"
              // noopener/noreferrer: target=_blank otherwise gives the opened
              // page access to window.opener.
              rel="noopener noreferrer"
            >
              <span className="news__headline">{article.headline}</span>
              <span className="news__meta">
                {article.source && <span>{article.source}</span>}
                {article.published_at && (
                  <span>· {formatTimestamp(article.published_at, false)}</span>
                )}
                <span aria-hidden="true">↗</span>
                <span className="visually-hidden">opens in a new tab</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="risk__basis">{news.disclaimer}</p>
    </Card>
  );
}

// --- unavailable capability ------------------------------------------------

export function CapabilityNotice({ title, note }: { title: string; note: string }) {
  return (
    <Card title={title}>
      <p className="unavailable">{note}</p>
    </Card>
  );
}
