import { useMemo, useState } from "react";

import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { formatPercentPlain } from "../../lib/format";
import type { PatternsResponse, PatternSummary } from "../../types/market";
import "./patterns.css";

/**
 * Historical pattern analysis.
 *
 * Everything here is past tense by design: events say when something happened
 * and what the numbers were; outcome tables say what actually followed, with
 * the sample size in front of the statistics rather than behind them. Nothing
 * is called a signal, and small samples are labeled as such instead of being
 * dressed up as evidence.
 */

const EVENTS_SHOWN = 12;

function OutcomeTable({ summary }: { summary: PatternSummary }) {
  const populated = summary.outcomes.filter((outcome) => outcome.sample_size > 0);
  if (populated.length === 0) {
    return (
      <p className="pt-outcome-empty">
        No occurrence has enough later history to measure outcomes in this window.
      </p>
    );
  }

  return (
    <table className="pt-table">
      <caption className="visually-hidden">
        Historical outcomes after {summary.label} events
      </caption>
      <thead>
        <tr>
          <th scope="col">After</th>
          <th scope="col">Sample</th>
          <th scope="col">Median</th>
          <th scope="col">Mean</th>
          <th scope="col">Rose</th>
          <th scope="col">Worst</th>
          <th scope="col">Best</th>
        </tr>
      </thead>
      <tbody>
        {populated.map((outcome) => (
          <tr key={outcome.window}>
            <th scope="row">{outcome.window} bars</th>
            <td className="numeric">
              {outcome.sample_size}
              {outcome.small_sample && (
                <span className="pt-small-sample"> small sample</span>
              )}
              {outcome.excluded > 0 && (
                <span className="pt-excluded"> ({outcome.excluded} too recent)</span>
              )}
            </td>
            <td className="numeric">{formatPercentPlain(outcome.median)}</td>
            <td className="numeric">{formatPercentPlain(outcome.mean)}</td>
            <td className="numeric">{formatPercentPlain(outcome.positive_share)}</td>
            <td className="numeric">{formatPercentPlain(outcome.worst)}</td>
            <td className="numeric">{formatPercentPlain(outcome.best)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface PatternsPanelProps {
  data: PatternsResponse | null;
  loading: boolean;
  error: string | null;
  ticker: string;
  started: boolean;
  onRun: () => void;
}

export function PatternsPanel({
  data,
  loading,
  error,
  ticker,
  started,
  onRun,
}: PatternsPanelProps) {
  const [filter, setFilter] = useState<string>("all");
  const [showAllEvents, setShowAllEvents] = useState(false);

  const activeSummaries = useMemo(
    () => (data ? data.summaries.filter((summary) => summary.occurrences > 0) : []),
    [data],
  );

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    const events =
      filter === "all"
        ? data.events
        : data.events.filter((event) => event.pattern === filter);
    // Most recent first: the question a reader asks is "what happened lately?"
    return [...events].reverse();
  }, [data, filter]);

  const visibleEvents = showAllEvents
    ? filteredEvents
    : filteredEvents.slice(0, EVENTS_SHOWN);

  if (!started) {
    return (
      <Card title="Historical patterns">
        <div className="pt-intro">
          <p className="pt-intro__body">
            Scan {ticker}&rsquo;s history for well-known technical events — crossovers,
            RSI extremes, unusually large moves, drawdown recoveries — and see when each
            occurred and what actually followed. These are descriptions of the past, not
            signals.
          </p>
          <Button variant="primary" onClick={onRun}>
            Scan the history
          </Button>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Historical patterns">
        <Callout tone="note" role="alert">
          {error}
        </Callout>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card title="Historical patterns">
        <div className="pt-loading">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} height={90} />
          ))}
        </div>
      </Card>
    );
  }

  if (data.insufficient) {
    return (
      <Card title="Historical patterns">
        <Callout tone="note">{data.note}</Callout>
      </Card>
    );
  }

  return (
    <Card
      title="Historical patterns"
      action={
        <span className="eyebrow">
          {data.bars} bars · {data.start_date} to {data.end_date}
        </span>
      }
    >
      <div className="pt-summaries">
        {activeSummaries.map((summary) => (
          <details key={summary.pattern} className="pt-summary">
            <summary className="pt-summary__head">
              <span className="pt-summary__label">{summary.label}</span>
              <span className="numeric pt-summary__count">
                {summary.occurrences}{" "}
                {summary.occurrences === 1 ? "occurrence" : "occurrences"}
              </span>
            </summary>
            <div className="pt-summary__body">
              <p className="pt-definition">{summary.definition}</p>
              <h4 className="eyebrow">Historical outcomes after similar events</h4>
              <OutcomeTable summary={summary} />
              <p className="pt-caveat">{summary.caveat}</p>
            </div>
          </details>
        ))}
        {activeSummaries.length === 0 && (
          <p className="pt-outcome-empty">No pattern events occurred in this window.</p>
        )}
      </div>

      {data.events.length > 0 && (
        <div className="pt-timeline">
          <div className="pt-timeline__head">
            <h3 className="eyebrow">Event timeline (most recent first)</h3>
            <label className="pt-filter">
              <span className="visually-hidden">Filter events by pattern</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All patterns ({data.events.length})</option>
                {activeSummaries.map((summary) => (
                  <option key={summary.pattern} value={summary.pattern}>
                    {summary.label} ({summary.occurrences})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ol className="pt-events">
            {visibleEvents.map((event) => (
              <li key={`${event.pattern}-${event.date}`} className="pt-event">
                <span className="pt-event__date numeric">{event.date}</span>
                <div className="pt-event__body">
                  <span className="pt-event__label">{event.label}</span>
                  <span className="pt-event__explanation">{event.explanation}</span>
                </div>
              </li>
            ))}
          </ol>

          {filteredEvents.length > EVENTS_SHOWN && (
            <Button
              variant="ghost"
              small
              onClick={() => setShowAllEvents((value) => !value)}
            >
              {showAllEvents ? "Show fewer" : `Show all ${filteredEvents.length} events`}
            </Button>
          )}
        </div>
      )}

      <Callout tone="accent">
        <div>
          <p className="pt-method">{data.method}</p>
          <p className="pt-method pt-method--warn">{data.disclaimer}</p>
        </div>
      </Callout>
    </Card>
  );
}
