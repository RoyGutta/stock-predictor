import { useState } from "react";

import { Button, Callout, Card, Skeleton, Stat } from "../../components/ui";
import { formatPrice, formatRatio, formatVolume, safeExternalUrl } from "../../lib/format";
import type { CompanyProfile } from "../../types/market";
import "./profile.css";

/** Longer descriptions are collapsed; provider text runs to several paragraphs. */
const DESCRIPTION_CLAMP = 320;

/**
 * Market capitalisation in words as well as figures.
 *
 * "$3.4T" is precise and means nothing to someone new. The size bracket is the
 * part that actually informs — it is what tells a beginner whether they are
 * looking at a household name or something small enough to move on one order.
 */
function sizeBracket(marketCap: number | null): string | null {
  if (marketCap === null) return null;
  if (marketCap >= 200e9) return "Mega cap — among the largest companies listed";
  if (marketCap >= 10e9) return "Large cap";
  if (marketCap >= 2e9) return "Mid cap";
  if (marketCap >= 300e6) return "Small cap — smaller companies tend to swing harder";
  return "Micro cap — very small, and typically the most volatile";
}

function formatMarketCap(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [scale, suffix] of units) {
    if (Math.abs(value) >= scale) return `$${(value / scale).toFixed(2)}${suffix}`;
  }
  return formatPrice(value);
}

interface ProfilePanelProps {
  profile: CompanyProfile | null;
  loading: boolean;
  error: string | null;
  ticker: string;
}

export function ProfilePanel({ profile, loading, error, ticker }: ProfilePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <Card title={`About ${ticker}`}>
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }

  if (loading || !profile) {
    return (
      <Card title={`About ${ticker}`}>
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <Skeleton height={20} />
          <Skeleton height={60} />
        </div>
      </Card>
    );
  }

  const website = safeExternalUrl(profile.website);
  const bracket = sizeBracket(profile.market_cap);
  const description = profile.description ?? "";
  const isLong = description.length > DESCRIPTION_CLAMP;
  const shown = expanded || !isLong ? description : `${description.slice(0, DESCRIPTION_CLAMP)}…`;

  return (
    <Card
      title={`About ${profile.name ?? profile.ticker}`}
      action={
        profile.is_etf ? <span className="eyebrow">Fund</span> : <span className="eyebrow">Company</span>
      }
    >
      <div className="profile-tags">
        {profile.sector && <span className="profile-tag">{profile.sector}</span>}
        {profile.industry && <span className="profile-tag">{profile.industry}</span>}
        {profile.exchange && <span className="profile-tag">{profile.exchange}</span>}
        {profile.country && <span className="profile-tag">{profile.country}</span>}
      </div>

      {description && (
        <div className="profile-description">
          <p>{shown}</p>
          {isLong && (
            <Button variant="ghost" small onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : "Read more"}
            </Button>
          )}
        </div>
      )}

      <div className="profile-grid">
        <Stat
          label="Market cap"
          term="marketCap"
          value={formatMarketCap(profile.market_cap)}
          note={bracket ?? undefined}
        />
        <Stat
          label="Beta"
          term="beta"
          value={formatRatio(profile.beta)}
          note="Provider figure, own window"
        />
        <Stat
          label="Average volume"
          term="volume"
          value={formatVolume(profile.average_volume)}
          note="Shares per day"
        />
        {profile.employees !== null && (
          <Stat label="Employees" value={formatVolume(profile.employees)} />
        )}
        {profile.last_dividend !== null && profile.last_dividend > 0 && (
          <Stat
            label="Last dividend"
            value={formatPrice(profile.last_dividend)}
            note="Per share, most recent"
          />
        )}
        {profile.ceo && <Stat label="CEO" value={profile.ceo} />}
      </div>

      <p className="risk__basis">
        Company details from {profile.source}.{" "}
        {/* The provider computes beta over its own undisclosed window, which
            need not match the beta this app computes from the selected range.
            Two different numbers under one name confuses more than it helps
            unless the difference is stated. */}
        Beta here is the provider&rsquo;s own figure over a window it does not
        publish, so it will not always match the beta in the risk panel above,
        which is computed from the range you selected.
        {website && (
          <>
            {" "}
            <a href={website} target="_blank" rel="noopener noreferrer">
              Company website
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </>
        )}
      </p>
    </Card>
  );
}
