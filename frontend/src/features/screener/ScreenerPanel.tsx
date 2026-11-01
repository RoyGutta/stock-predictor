import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, Callout, Card, Skeleton } from "../../components/ui";
import { ApiError, isAbort } from "../../lib/api";
import type {
  ScreenerCriteria,
  ScreenerQuery,
  ScreenerResponse,
  ScreenerSortKey,
  SizeBandKey,
} from "../../types/screener";
import { formatRetrieved } from "../sec/secFormat";
import "../sec/sec.css";
import "./screener.css";
import {
  DEFAULT_CRITERIA,
  SIZE_BAND_LABELS,
  readSaved,
  removeSaved,
  upsertSaved,
  type SavedCriteria,
} from "./savedCriteria";
import { fetchScreener } from "./screenerApi";
import { ScreenerTable } from "./ScreenerTable";

const PAGE_SIZE = 25;
const DEFAULT_NOTE =
  "The fundamentals screener needs SEC access, which is not enabled on this server. " +
  "SEC requires automated requests to declare a name and contact email: set " +
  "SEC_USER_AGENT on the backend (see README).";

const METHODOLOGY = [
  "A research screen on figures companies reported to the SEC. It is not a recommendation, and the order of results says nothing about investment merit.",
  "No valuation metrics (such as P/E): this app has no licensed price data, so the screen uses reported figures only.",
  "SEC frames calendar-align fiscal years: each company's fiscal year is placed in the calendar year it most overlaps, so periods are comparable but not identical.",
  "A dash means the company did not report that figure for the period. A filter on a figure leaves out companies for which it is unknown. Industry is not available from frames, so peers are grouped by revenue size band.",
];

interface Draft {
  minRevenueM: string;
  minGrowth: string;
  maxGrowth: string;
  minNetMargin: string;
  maxLiabilitiesToAssets: string;
  positiveFcf: boolean;
  name: string;
  sizeBand: string;
}

const str = (value: number | null, scale = 1) =>
  value === null ? "" : String(value / scale);

function toDraft(c: ScreenerCriteria): Draft {
  return {
    minRevenueM: str(c.minRevenue, 1e6),
    minGrowth: str(c.minGrowth),
    maxGrowth: str(c.maxGrowth),
    minNetMargin: str(c.minNetMargin),
    maxLiabilitiesToAssets: str(c.maxLiabilitiesToAssets),
    positiveFcf: c.positiveFcf,
    name: c.name,
    sizeBand: c.sizeBand ?? "",
  };
}

/** Parses the form; returns an error sentence instead when a field is invalid. */
function fromDraft(d: Draft): ScreenerCriteria | string {
  const num = (text: string): number | null | undefined => {
    if (text.trim() === "") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  };
  const fields = [
    num(d.minRevenueM),
    num(d.minGrowth),
    num(d.maxGrowth),
    num(d.minNetMargin),
    num(d.maxLiabilitiesToAssets),
  ];
  if (fields.some((v) => v === undefined)) return "Enter numbers only.";
  const [minRevenueM, minGrowth, maxGrowth, minNetMargin, maxLta] = fields as (
    number | null
  )[];
  if (minRevenueM !== null && minRevenueM < 0)
    return "Minimum revenue cannot be negative.";
  if (maxLta !== null && maxLta < 0)
    return "Liabilities / assets cannot be negative.";
  if (minGrowth !== null && maxGrowth !== null && minGrowth > maxGrowth)
    return "Minimum growth is above maximum growth.";
  return {
    minRevenue: minRevenueM === null ? null : minRevenueM * 1e6,
    minGrowth,
    maxGrowth,
    minNetMargin,
    maxLiabilitiesToAssets: maxLta,
    positiveFcf: d.positiveFcf,
    name: d.name.trim(),
    sizeBand:
      d.sizeBand in SIZE_BAND_LABELS ? (d.sizeBand as SizeBandKey) : null,
  };
}

interface State {
  data: ScreenerResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Screens SEC filers on reported fundamentals from XBRL frames. Each row
 * links to the company's EDGAR page; there are no tickers or prices here.
 */
export function ScreenerPanel({
  enabled,
  note,
}: {
  enabled: boolean;
  note?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(DEFAULT_CRITERIA));
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState<ScreenerQuery>({
    ...DEFAULT_CRITERIA,
    sort: "revenue",
    order: "desc",
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [state, setState] = useState<State>({
    data: null,
    loading: enabled,
    error: null,
  });
  const [saved, setSaved] = useState<SavedCriteria[]>(() => readSaved());
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchScreener(query, controller.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        const message =
          error instanceof ApiError
            ? error.message
            : "The screen could not be run.";
        setState({ data: null, loading: false, error: message });
      });
    return () => controller.abort();
  }, [enabled, query]);

  if (!enabled) {
    return (
      <Card title="Fundamentals screener">
        <Callout tone="note">{note ?? DEFAULT_NOTE}</Callout>
      </Card>
    );
  }

  const field = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = fromDraft(draft);
    if (typeof parsed === "string") {
      setFormError(parsed);
      return;
    }
    setFormError(null);
    setQuery((prev) => ({ ...prev, ...parsed, offset: 0 }));
  };

  const onSort = (key: ScreenerSortKey) =>
    setQuery((prev) => ({
      ...prev,
      sort: key,
      order:
        prev.sort === key
          ? prev.order === "asc"
            ? "desc"
            : "asc"
          : key === "name"
            ? "asc"
            : "desc",
      offset: 0,
    }));

  const save = () => {
    const name = saveName.trim();
    const parsed = fromDraft(draft);
    if (!name) {
      setFormError("Name the criteria set before saving it.");
      return;
    }
    if (typeof parsed === "string") {
      setFormError(parsed);
      return;
    }
    setFormError(null);
    setSaved((list) => upsertSaved(list, { name, criteria: parsed }));
    setSaveName("");
  };

  const apply = (entry: SavedCriteria) => {
    setDraft(toDraft(entry.criteria));
    setFormError(null);
    setQuery((prev) => ({ ...prev, ...entry.criteria, offset: 0 }));
  };

  const { data, loading, error } = state;
  const page = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const pages = data
    ? Math.max(1, Math.ceil(data.total_matches / data.limit))
    : 1;

  return (
    <Card title="Fundamentals screener">
      <ul className="screener__method" aria-label="Methodology and limitations">
        {METHODOLOGY.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <form
        className="screener__form"
        onSubmit={submit}
        aria-label="Screening criteria"
      >
        <label htmlFor={`${id}-rev`}>
          Minimum revenue ($ millions)
          <input
            id={`${id}-rev`}
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={draft.minRevenueM}
            onChange={(e) => field("minRevenueM", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-gmin`}>
          Minimum revenue growth (%)
          <input
            id={`${id}-gmin`}
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.minGrowth}
            onChange={(e) => field("minGrowth", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-gmax`}>
          Maximum revenue growth (%)
          <input
            id={`${id}-gmax`}
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.maxGrowth}
            onChange={(e) => field("maxGrowth", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-nm`}>
          Minimum net margin (%)
          <input
            id={`${id}-nm`}
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.minNetMargin}
            onChange={(e) => field("minNetMargin", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-lta`}>
          Maximum liabilities / assets
          <input
            id={`${id}-lta`}
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={draft.maxLiabilitiesToAssets}
            onChange={(e) => field("maxLiabilitiesToAssets", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-name`}>
          Name contains
          <input
            id={`${id}-name`}
            type="text"
            maxLength={80}
            value={draft.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <label htmlFor={`${id}-band`}>
          Revenue size band
          <select
            id={`${id}-band`}
            value={draft.sizeBand}
            onChange={(e) => field("sizeBand", e.target.value)}
          >
            <option value="">Any size</option>
            {Object.entries(SIZE_BAND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="screener__check" htmlFor={`${id}-fcf`}>
          <input
            id={`${id}-fcf`}
            type="checkbox"
            checked={draft.positiveFcf}
            onChange={(e) => field("positiveFcf", e.target.checked)}
          />
          Positive free cash flow only
        </label>
        <div className="screener__actions">
          <Button type="submit" variant="primary">
            Run screen
          </Button>
        </div>
        {formError && (
          <p className="screener__error" role="alert">
            {formError}
          </p>
        )}
      </form>

      <div className="screener__saved">
        <label htmlFor={`${id}-save`}>
          Save these criteria as
          <input
            id={`${id}-save`}
            type="text"
            maxLength={60}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
          />
        </label>
        <Button onClick={save}>Save criteria</Button>
        {saved.length > 0 && (
          <ul aria-label="Saved criteria">
            {saved.map((entry) => (
              <li key={entry.name}>
                <span>{entry.name}</span>{" "}
                <Button small onClick={() => apply(entry)}>
                  Apply <span className="visually-hidden">{entry.name}</span>
                </Button>{" "}
                <Button
                  small
                  variant="ghost"
                  onClick={() =>
                    setSaved((list) => removeSaved(list, entry.name))
                  }
                >
                  Delete <span className="visually-hidden">{entry.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <Callout tone="note">{error}</Callout>}
      {loading && !data && (
        <div className="sec__loading" aria-busy="true">
          <Skeleton height={24} />
          <Skeleton height={160} />
        </div>
      )}
      {data && (
        <div aria-busy={loading}>
          <p className="sec__source">
            Source: {data.source}, XBRL frames for calendar year{" "}
            {data.calendar_year} (growth against {data.prior_calendar_year}).
            {data.retrieved_at
              ? ` Retrieved from SEC ${formatRetrieved(data.retrieved_at)}.`
              : " SEC has not published these frames yet."}{" "}
            {data.total_matches} of {data.universe} filers match.
          </p>
          {data.stale && (
            <Callout tone="note">
              SEC could not be reached just now
              {data.stale_reason ? ` (${data.stale_reason})` : ""}. Showing an
              earlier copy; figures filed since then are missing.
            </Callout>
          )}
          <p className="sec__meta screener__frames">
            Frames used:{" "}
            {data.frames.map((frame, i) => (
              <span key={frame.url}>
                {i > 0 ? ", " : ""}
                <a href={frame.url} target="_blank" rel="noopener noreferrer">
                  {frame.tag} {frame.period}{" "}
                  <span className="visually-hidden">(opens in a new tab)</span>
                </a>
                {frame.available ? "" : " (not published)"}
              </span>
            ))}
          </p>
          {data.results.length === 0 ? (
            <p className="sec__empty">No filers match these criteria.</p>
          ) : (
            <ScreenerTable
              rows={data.results}
              sort={query.sort}
              order={query.order}
              onSort={onSort}
              caption={`Filers matching the criteria, page ${page} of ${pages}. Choose a column heading to sort.`}
            />
          )}
          <div className="screener__pager">
            <Button
              small
              disabled={data.offset === 0}
              onClick={() =>
                setQuery((p) => ({
                  ...p,
                  offset: Math.max(0, p.offset - p.limit),
                }))
              }
            >
              Previous page
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button
              small
              disabled={data.offset + data.limit >= data.total_matches}
              onClick={() =>
                setQuery((p) => ({ ...p, offset: p.offset + p.limit }))
              }
            >
              Next page
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
