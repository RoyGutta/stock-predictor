import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Callout, Card, Skeleton } from "../components/ui";
import { Link } from "../app/router";
import { ApiError, fetchExploreMatch, isAbort } from "../lib/api";
import { formatPercentPlain, formatRatio } from "../lib/format";
import type {
  ExploreMatch,
  ExplorePreferences,
  ExploreResponse,
} from "../types/market";
import "./explore.css";

/**
 * Preference-matching exploration, not recommendation.
 *
 * The form only contains inputs that actually change the result -- a dollar
 * amount field that silently did nothing would be dishonest UI, so amounts
 * live in the portfolio replay instead. Every match score is a count of
 * criteria met, and every criterion renders with its status; the measured
 * sentences sit one disclosure away, never the verdicts themselves.
 */

const DEFAULTS: ExplorePreferences = {
  volatility: "moderate",
  diversification: "any",
  horizon: "longer",
  interests: [],
};

const VOLATILITY_OPTIONS = [
  { value: "lower", label: "Calmer", hint: "smaller historical swings" },
  { value: "moderate", label: "Middle", hint: "middle of this list" },
  { value: "higher", label: "Wilder", hint: "larger historical swings" },
] as const;

const HORIZON_OPTIONS = [
  { value: "shorter", label: "About a year", hint: "measures the last 1Y, daily bars" },
  { value: "longer", label: "Several years", hint: "measures the last 5Y, weekly bars" },
] as const;

const DIVERSIFICATION_OPTIONS = [
  { value: "broad", label: "Broadly diversified", hint: "hundreds of holdings per fund" },
  { value: "any", label: "Any breadth", hint: "sector and single-asset funds included" },
] as const;

function MatchRow({ match }: { match: ExploreMatch }) {
  return (
    <li className="xp-match">
      <div className="xp-match__head">
        <div className="xp-match__identity">
          <Link to="analyze" param={match.ticker} className="xp-match__ticker">
            {match.ticker}
          </Link>
          <span className="xp-match__name">{match.name}</span>
          <span className="xp-match__category">
            {match.category} · {match.breadth} · {match.asset_class}
          </span>
        </div>
        <div
          className="xp-match__score"
          aria-label={`${match.score} of ${match.total} stated preferences matched`}
        >
          <span className="numeric xp-match__score-value">
            {match.score}/{match.total}
          </span>
          <span className="xp-match__score-label">preferences matched</span>
        </div>
      </div>

      <ul className="xp-criteria">
        {match.criteria.map((criterion) => (
          <li
            key={criterion.name}
            className={`xp-criterion${criterion.met ? " xp-criterion--met" : ""}`}
          >
            <span aria-hidden="true">{criterion.met ? "✓" : "✕"}</span>
            <span className="visually-hidden">
              {criterion.met ? "matched:" : "not matched:"}
            </span>
            {criterion.name}
          </li>
        ))}
      </ul>

      <dl className="xp-stats">
        <div>
          <dt>Return (ann.)</dt>
          <dd className="numeric">{formatPercentPlain(match.annualized_return)}</dd>
        </div>
        <div>
          <dt>Volatility</dt>
          <dd className="numeric">{formatPercentPlain(match.annualized_volatility)}</dd>
        </div>
        <div>
          <dt>Max drawdown</dt>
          <dd className="numeric">{formatPercentPlain(match.max_drawdown)}</dd>
        </div>
        <div>
          <dt>Corr. to SPY</dt>
          <dd className="numeric">{formatRatio(match.correlation_to_benchmark)}</dd>
        </div>
      </dl>

      <details className="xp-why">
        <summary>Why these checks came out this way</summary>
        <ul className="xp-why__list">
          {match.criteria.map((criterion) => (
            <li key={criterion.name}>
              <strong>{criterion.name}:</strong> {criterion.detail}
            </li>
          ))}
          <li>
            <strong>What it tracks:</strong> {match.tracks}
          </li>
        </ul>
      </details>
    </li>
  );
}

/** Historical performance by category over the stated window, period labeled. */
function CategoryStrip({ data }: { data: ExploreResponse }) {
  const byCategory = useMemo(() => {
    const groups = new Map<string, ExploreMatch[]>();
    for (const match of data.matches) {
      const list = groups.get(match.category) ?? [];
      list.push(match);
      groups.set(match.category, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.matches]);

  return (
    <Card
      title={`Historical ${data.range} performance by category`}
      action={<span className="eyebrow">{data.frequency} bars</span>}
    >
      <div className="xp-strip" role="list">
        {byCategory.map(([category, funds]) => (
          <div key={category} className="xp-strip__tile" role="listitem">
            <span className="xp-strip__category">{category}</span>
            {funds.map((fund) => (
              <span key={fund.ticker} className="xp-strip__fund">
                <Link to="analyze" param={fund.ticker}>
                  {fund.ticker}
                </Link>
                <span
                  className="numeric"
                  style={{
                    color:
                      (fund.annualized_return ?? 0) === 0
                        ? undefined
                        : (fund.annualized_return ?? 0) > 0
                          ? "var(--up)"
                          : "var(--down)",
                  }}
                >
                  {formatPercentPlain(fund.annualized_return)}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="xp-note">
        Annualized historical return over the stated window. Strong past performance in a
        category says nothing about its future performance.
      </p>
    </Card>
  );
}

export function ExplorePage() {
  const [preferences, setPreferences] = useState<ExplorePreferences>(DEFAULTS);
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const run = useCallback((next: ExplorePreferences) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);

    fetchExploreMatch(next, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
        setLoading(false);
      });
  }, []);

  // Load once with defaults so the page teaches by example immediately.
  useEffect(() => {
    run(DEFAULTS);
    return () => inFlight.current?.abort();
  }, [run]);

  const toggleInterest = (category: string) =>
    setPreferences((current) => ({
      ...current,
      interests: current.interests.includes(category)
        ? current.interests.filter((item) => item !== category)
        : [...current.interests, category],
    }));

  return (
    <div className="page">
      <Card
        title="Explore funds by your stated preferences"
        action={<span className="eyebrow">Educational matching</span>}
      >
        <p className="xp-intro">
          Pick what you care about and see which funds in a small, disclosed list
          historically matched those preferences — with every check shown. This is an
          educational comparison, not a recommendation. Dollar amounts do not change what
          history shows; to replay an amount, use the{" "}
          <Link to="portfolio">portfolio simulator</Link>.
        </p>

        <form
          className="xp-form"
          onSubmit={(event) => {
            event.preventDefault();
            run(preferences);
          }}
        >
          <fieldset className="xp-fieldset">
            <legend>Comfort with swings</legend>
            {VOLATILITY_OPTIONS.map((option) => (
              <label key={option.value} className="xp-radio">
                <input
                  type="radio"
                  name="volatility"
                  value={option.value}
                  checked={preferences.volatility === option.value}
                  onChange={() =>
                    setPreferences((current) => ({ ...current, volatility: option.value }))
                  }
                />
                <span>
                  {option.label} <em>({option.hint})</em>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="xp-fieldset">
            <legend>Time horizon</legend>
            {HORIZON_OPTIONS.map((option) => (
              <label key={option.value} className="xp-radio">
                <input
                  type="radio"
                  name="horizon"
                  value={option.value}
                  checked={preferences.horizon === option.value}
                  onChange={() =>
                    setPreferences((current) => ({ ...current, horizon: option.value }))
                  }
                />
                <span>
                  {option.label} <em>({option.hint})</em>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="xp-fieldset">
            <legend>Diversification</legend>
            {DIVERSIFICATION_OPTIONS.map((option) => (
              <label key={option.value} className="xp-radio">
                <input
                  type="radio"
                  name="diversification"
                  value={option.value}
                  checked={preferences.diversification === option.value}
                  onChange={() =>
                    setPreferences((current) => ({
                      ...current,
                      diversification: option.value,
                    }))
                  }
                />
                <span>
                  {option.label} <em>({option.hint})</em>
                </span>
              </label>
            ))}
          </fieldset>

          {data && data.available_interests.length > 0 && (
            <fieldset className="xp-fieldset">
              <legend>Sector interests (optional)</legend>
              <div className="xp-checks">
                {data.available_interests.map((category) => (
                  <label key={category} className="xp-radio">
                    <input
                      type="checkbox"
                      checked={preferences.interests.includes(category)}
                      onChange={() => toggleInterest(category)}
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Measuring…" : "Match my preferences"}
          </Button>
        </form>
      </Card>

      {error && (
        <Callout tone="error" role="alert">
          {error}
        </Callout>
      )}

      {loading && !data && (
        <div className="xp-loading">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={140} />
          ))}
        </div>
      )}

      {data && (
        <>
          <Card
            title="How each fund matched"
            action={
              <span className="eyebrow">
                {data.range} window · {data.frequency} bars
              </span>
            }
          >
            <p className="xp-note">{data.universe_note}</p>

            {Object.keys(data.unavailable).length > 0 && (
              <Callout tone="note">
                Could not measure:{" "}
                {Object.entries(data.unavailable)
                  .map(([symbol, reason]) => `${symbol} (${reason})`)
                  .join("; ")}
              </Callout>
            )}

            <ol className="xp-matches">
              {data.matches.map((match) => (
                <MatchRow key={match.ticker} match={match} />
              ))}
            </ol>

            <p className="xp-note">{data.method}</p>
            <Callout tone="accent">
              <p className="xp-note xp-note--strong">{data.disclaimer}</p>
            </Callout>
          </Card>

          <CategoryStrip data={data} />
        </>
      )}
    </div>
  );
}
