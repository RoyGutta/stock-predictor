import { Callout, Card, Skeleton, Stat } from "../../components/ui";
import { formatRetrieved } from "../sec/secFormat";
import type { YieldCurveResponse } from "../../types/treasury";
import { SpreadHistoryChart } from "./SpreadHistoryChart";
import {
  formatBpChange,
  formatObservationDate,
  formatSpread,
  formatYield,
  shapeText,
} from "./treasuryFormat";
import { YieldCurveChart } from "./YieldCurveChart";
import "./treasury.css";

interface Props {
  data: YieldCurveResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Official U.S. Treasury par yields: the latest published curve, two spreads,
 * one-month changes, and recent spread history. Real data in every deployment,
 * including the public demo, and labelled separately from the synthetic prices.
 */
export function TreasuryPanel({ data, loading, error }: Props) {
  const title = "U.S. Treasury yields";
  if (error) {
    return (
      <Card title={title}>
        <Callout tone="note">
          Treasury yield data could not be loaded: {error} Nothing is shown in
          its place.
        </Callout>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card title={title}>
        <div className="ust-loading" aria-busy="true">
          <Skeleton height={20} />
          <Skeleton height={160} />
        </div>
      </Card>
    );
  }

  const { latest } = data;
  const observed = formatObservationDate(latest.date);
  const compared = latest.comparison_date
    ? formatObservationDate(latest.comparison_date)
    : null;
  const tenThree = latest.spreads.find((s) => s.key === "10y_3m");

  return (
    <Card title={title} action={<span className="eyebrow">Official data</span>}>
      <p className="ust-source">
        Source: {data.source}. Latest published observation:{" "}
        <strong>{observed}</strong>
        {data.observation_age_days > 0 &&
          ` (${data.observation_age_days} day${data.observation_age_days === 1 ? "" : "s"} before today)`}
        . Retrieved from Treasury {formatRetrieved(data.retrieved_at)}.{" "}
        <a href={data.source_url} target="_blank" rel="noopener noreferrer">
          Treasury rates page
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>

      {data.stale && (
        <Callout tone="note">
          Treasury could not be reached just now
          {data.stale_reason ? ` (${data.stale_reason})` : ""}. Showing the copy
          retrieved {formatRetrieved(data.retrieved_at)}; a newer observation
          may exist.
        </Callout>
      )}
      {data.notes.map((note) => (
        <p key={note} className="ust-note">
          {note}
        </p>
      ))}

      <p className="ust-shape">
        <strong>{shapeText(latest.shape, data.upward_threshold_pp)}</strong>{" "}
        {tenThree?.value_pp != null &&
          `The 10-year minus 3-month spread is ${formatSpread(tenThree.value_pp, tenThree.value_bp)}.`}{" "}
        A negative spread is called an inversion; the{" "}
        {data.upward_threshold_pp.toFixed(2)}-point line between flat and upward
        sloping is this application&rsquo;s convention. Inversions have preceded
        some U.S. recessions, but they are not a forecast and have not always
        been followed by one.
      </p>

      <div className="ust-spreads">
        {latest.spreads.map((s) => (
          <Stat
            key={s.key}
            label={s.label}
            term="yieldSpread"
            value={formatSpread(s.value_pp, s.value_bp)}
            note={
              s.change_bp == null
                ? "No comparison available"
                : `${formatBpChange(s.change_bp)} since ${compared}`
            }
          />
        ))}
      </div>

      <YieldCurveChart
        curve={latest.curve}
        date={observed}
        comparisonDate={compared}
      />
      <p className="ust-legend">
        <span className="ust-legend__solid" aria-hidden="true" /> {observed}
        {compared && (
          <>
            {" "}
            <span className="ust-legend__dashed" aria-hidden="true" />{" "}
            {compared}
          </>
        )}
        {" · "}maturities evenly spaced, not to time scale
      </p>

      <div className="ust-table-scroll">
        <table className="ust-table">
          <caption className="visually-hidden">
            Treasury par yields by maturity on {observed}
            {compared ? ` and ${compared}` : ""}, in percent
          </caption>
          <thead>
            <tr>
              <th scope="col">Maturity</th>
              <th scope="col">{observed}</th>
              {compared && <th scope="col">{compared}</th>}
              {compared && <th scope="col">Change</th>}
            </tr>
          </thead>
          <tbody>
            {latest.curve.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.label}</th>
                <td>
                  <YieldCell value={p.value} />
                </td>
                {compared && (
                  <td>
                    <YieldCell value={p.prior_value} />
                  </td>
                )}
                {compared && <td>{formatBpChange(p.change_bp)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ust-subtitle">Spreads over recent months</h3>
      <SpreadHistoryChart rows={data.history} />

      <p className="ust-note">{data.methodology}</p>
      <p className="ust-note">
        These are interest rates, not stock prices, and they are separate from
        the price data elsewhere on this site. Nothing here predicts rates or
        markets.
      </p>
    </Card>
  );
}

function YieldCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">Not published</span>
      </>
    );
  }
  return <>{formatYield(value)}</>;
}
