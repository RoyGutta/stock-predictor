import { useEffect, useMemo, useState } from "react";

import { Callout, Card, Skeleton } from "../../components/ui";
import { EMPTY } from "../../lib/format";
import type {
  DerivedPoint,
  DerivedSeries,
  FactPoint,
  FundamentalsPeriod,
  FundamentalsResponse,
  MetricSeries,
} from "../../types/sec";
import { describePeriod, formatReported, yoyText } from "./secFormat";
import { SourceLine } from "./SourceLine";
import { TrendBars } from "./TrendBars";
import type { SecState } from "./useSec";
import "./sec.css";

const COLUMNS = 5;
// At phone width the table keeps the two most recent periods; the detail table
// under it still lists every period.
const NARROW_COLUMNS = 2;
const NARROW_QUERY = "(max-width: 560px)";

function matchNarrow(): MediaQueryList | null {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY)
    : null;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => matchNarrow()?.matches ?? false);
  useEffect(() => {
    const query = matchNarrow();
    if (!query) return;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

type Row = (MetricSeries | DerivedSeries) & { derived?: boolean };
type AnyPoint = FactPoint | DerivedPoint;

interface FundamentalsPanelProps {
  state: SecState<FundamentalsResponse>;
  period: FundamentalsPeriod;
  onPeriodChange: (period: FundamentalsPeriod) => void;
}

/**
 * Reported financial measures over recent periods, from SEC XBRL data.
 *
 * Every number is a value a company filed, labelled with its period; nothing
 * is estimated, annualized, or filled in. Gaps show the reason in words.
 */
export function FundamentalsPanel({
  state,
  period,
  onPeriodChange,
}: FundamentalsPanelProps) {
  const { data, loading, error } = state;
  const [selected, setSelected] = useState("revenue");
  const narrow = useNarrow();
  const shown = narrow ? NARROW_COLUMNS : COLUMNS;

  const columns = useMemo(() => {
    if (!data) return [];
    const ends = new Set<string>();
    data.metrics.forEach((m) =>
      m.points.forEach((p) => ends.add(p.period_end)),
    );
    return [...ends].sort().slice(-shown);
  }, [data, shown]);

  const rows: Row[] = useMemo(
    () =>
      data
        ? [
            ...data.metrics,
            ...data.derived.map((d) => ({ ...d, derived: true })),
          ]
        : [],
    [data],
  );

  const toggle = (
    <div className="ranges" role="group" aria-label="Reporting period">
      {(["annual", "quarterly"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="ranges__option"
          aria-pressed={period === value}
          onClick={() => onPeriodChange(value)}
        >
          {value === "annual" ? "Annual" : "Quarterly"}
        </button>
      ))}
    </div>
  );

  if (error) {
    return (
      <Card title="Reported financials">
        <Callout tone="note">{error}</Callout>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card title="Reported financials" action={toggle}>
        <div className="sec__loading" aria-busy="true">
          <Skeleton height={24} />
          <Skeleton height={120} />
        </div>
      </Card>
    );
  }

  if (data.coverage !== "us-gaap") {
    return (
      <Card title="Reported financials">
        <SourceLine provenance={data} company={data.company} />
        <p className="sec__empty">{data.coverage_note}</p>
      </Card>
    );
  }

  const active = rows.find((row) => row.key === selected) ?? rows[0];

  return (
    <Card title="Reported financials" action={toggle}>
      <SourceLine
        provenance={data}
        company={data.company}
        latestFiled={data.latest_filed}
      />
      <p className="sec__note">{data.note}</p>

      <div className="sec-table-scroll">
        <table className="sec-table">
          <caption className="visually-hidden">
            {period === "annual" ? "Annual" : "Quarterly"} reported figures,
            most recent {columns.length} periods. Choose a measure to see its
            full history and sources.
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {columns.map((end) => (
                <th scope="col" key={end}>
                  <span className="sec-table__period">Period ended</span> {end}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <MeasureRow
                key={row.key}
                row={row}
                columns={columns}
                active={row.key === active?.key}
                firstDerived={Boolean(row.derived) && !rows[index - 1]?.derived}
                onSelect={() => setSelected(row.key)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {active && <MeasureDetail row={active} />}

      {period === "quarterly" && (
        <p className="sec__note">
          Quarterly figures are only those a company reported for a single
          quarter. Most companies report the fourth quarter only inside the
          annual total, and cash-flow statements only as year-to-date totals;
          this view leaves those gaps rather than deriving quarters by
          subtraction.
        </p>
      )}
    </Card>
  );
}

function MeasureRow({
  row,
  columns,
  active,
  firstDerived,
  onSelect,
}: {
  row: Row;
  columns: string[];
  active: boolean;
  firstDerived: boolean;
  onSelect: () => void;
}) {
  const byEnd = new Map<string, AnyPoint>(
    row.points.map((p) => [p.period_end, p]),
  );
  return (
    <>
      {firstDerived && (
        <tr className="sec-table__section">
          <th scope="rowgroup" colSpan={columns.length + 1}>
            Computed here from the reported lines above (same period, same
            filing)
          </th>
        </tr>
      )}
      <tr
        className={
          active ? "sec-table__row sec-table__row--active" : "sec-table__row"
        }
      >
        <th scope="row">
          <button
            type="button"
            className="sec-table__measure"
            aria-pressed={active}
            onClick={onSelect}
          >
            {row.label}
          </button>
        </th>
        {row.points.length === 0 ? (
          <td colSpan={columns.length} className="sec-table__missing">
            {row.missing_reason}
          </td>
        ) : (
          columns.map((end) => {
            const point = byEnd.get(end);
            if (!point) {
              return (
                <td
                  key={end}
                  className="sec-table__cell"
                  title="Not reported for this period"
                >
                  {EMPTY}
                </td>
              );
            }
            const change = yoyText(point, row.unit);
            const fact = "revised" in point ? point : null;
            return (
              <td key={end} className="sec-table__cell">
                <span className="sec-table__value">
                  {formatReported(point.value, row.unit)}
                </span>
                {change && <span className="sec-table__yoy">{change}</span>}
                {fact?.revised && <span className="sec-tag">Revised</span>}
                {fact?.amended && (
                  <span className="sec-tag">Amended filing</span>
                )}
              </td>
            );
          })
        )}
      </tr>
    </>
  );
}

function MeasureDetail({ row }: { row: Row }) {
  const points = [...row.points].reverse();
  return (
    <section
      className="sec-detail"
      aria-label={`${row.label}: history and sources`}
    >
      <h3 className="sec-detail__title">{row.label}</h3>
      <p className="sec-detail__definition">
        {row.definition}
        {"caveat" in row ? ` ${row.caveat}` : ""}
      </p>
      {row.points.length === 0 ? (
        <p className="sec__empty">{row.missing_reason}</p>
      ) : (
        <>
          <TrendBars
            title={row.label}
            unit={row.unit}
            bars={row.points.map((p) => ({
              label: p.period_end.slice(0, 7),
              value: p.value,
            }))}
          />
          <div className="sec-table-scroll">
            <table className="sec-table sec-table--detail">
              <caption className="visually-hidden">
                {row.label}: every period and its filing
              </caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Value</th>
                  <th scope="col">Year over year</th>
                  <th scope="col">Reported in</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <DetailRow
                    key={`${point.period_start}-${point.period_end}`}
                    point={point}
                    unit={row.unit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function DetailRow({ point, unit }: { point: AnyPoint; unit: string }) {
  const fact = "revised" in point ? point : null;
  const components = "components" in point ? point.components : null;
  return (
    <tr>
      <th scope="row">
        {describePeriod(
          point.period_start,
          point.period_end,
          point.duration_days,
        )}
      </th>
      <td>
        {formatReported(point.value, unit)}
        {components && (
          <span className="sec-table__yoy">
            {Object.entries(components)
              .map(
                ([key, value]) =>
                  `${key.replace(/_/g, " ")} ${formatReported(value, "USD")}`,
              )
              .join(" · ")}
          </span>
        )}
        {fact?.revised && (
          <span className="sec-table__yoy">
            Revised; first reported as{" "}
            {formatReported(fact.first_reported_value, unit)}
          </span>
        )}
      </td>
      <td>
        {yoyText(point, unit) ?? "No comparable period a year earlier"}
        {point.yoy?.note && (
          <span className="sec-table__yoy">{point.yoy.note}</span>
        )}
      </td>
      <td>
        <a href={point.filing_url} target="_blank" rel="noopener noreferrer">
          {point.form} filed {point.filed}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        {fact && <span className="sec-table__tag">{fact.tag}</span>}
      </td>
    </tr>
  );
}
