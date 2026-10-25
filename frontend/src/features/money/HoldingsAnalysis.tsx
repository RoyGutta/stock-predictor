import { useState } from "react";

import { Card } from "../../components/ui";
import {
  compareToMix,
  MIX_BUCKET_LABELS,
  MIX_BUCKETS,
  REFERENCE_MIXES,
  SECTOR_LIMIT_PCT,
  SINGLE_HOLDING_LIMIT_PCT,
  validateMix,
  type Concentration,
  type MixBucket,
  type MixWeights,
  type Portfolio,
  type Slice,
} from "./holdings";
import { formatCents } from "./model";

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const pp = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)} pts`;

function AllocationTable({
  caption,
  slices,
}: {
  caption: string;
  slices: Slice[];
}) {
  return (
    <div className="money-table-scroll">
      <table className="money-table holdings-alloc">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.key}>
              <th scope="row">{s.label}</th>
              <td>{formatCents(s.value_cents)}</td>
              <td>
                <span className="holdings-share">
                  <span
                    className="holdings-bar"
                    role="img"
                    aria-label={`${s.label}: ${pct(s.pct)}`}
                  >
                    <span
                      className="holdings-bar__fill"
                      style={{ width: `${Math.min(100, s.pct)}%` }}
                    />
                  </span>
                  {pct(s.pct)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AllocationCard({ p }: { p: Portfolio }) {
  return (
    <Card title="Allocation">
      {p.valued_count === 0 ? (
        <p className="money-basis">
          No holding has a price and date yet, so there is nothing to allocate.
        </p>
      ) : (
        <>
          <p className="money-basis">
            Shares of {formatCents(p.total_valued_cents)} across{" "}
            {p.valued_count} holding{p.valued_count === 1 ? "" : "s"} with a
            dated price, in U.S.-dollar accounts.
          </p>
          <AllocationTable caption="By asset class" slices={p.by_class} />
          <AllocationTable caption="By sector" slices={p.by_sector} />
        </>
      )}
      {p.unvalued_count > 0 && (
        <p className="money-basis">
          <strong>Not included:</strong> {p.unvalued_count} holding
          {p.unvalued_count === 1 ? "" : "s"} ({pct(p.unvalued_pct_of_count)} of
          your holdings by count) without a dated price; their value is unknown,
          so every share above is of the valued part only.
          {p.unvalued_cost_basis_cents > 0 &&
            ` Their entered cost basis totals ${formatCents(p.unvalued_cost_basis_cents)}, shown for scale only.`}
        </p>
      )}
      {p.excluded.length > 0 && (
        <p className="money-basis">
          Also not included:{" "}
          {p.excluded
            .map((e) => `${e.holding.symbol || e.holding.name} (${e.reason})`)
            .join("; ")}
          .
        </p>
      )}
    </Card>
  );
}

export function ConcentrationCard({ c }: { c: Concentration }) {
  return (
    <Card title="Concentration">
      {c.largest == null ? (
        <p className="money-basis">
          Needs at least one holding with a price and date.
        </p>
      ) : (
        <dl className="holdings-facts">
          <div>
            <dt>Largest position</dt>
            <dd>
              {c.largest.label}: {pct(c.largest.pct)}
              {c.single_flag && " ⚑ concentration to review"}
            </dd>
          </div>
          <div>
            <dt>Top three positions</dt>
            <dd>{pct(c.top3_pct)}</dd>
          </div>
          <div>
            <dt>Largest sector</dt>
            <dd>
              {c.largest_sector
                ? `${c.largest_sector.label}: ${pct(c.largest_sector.pct)}`
                : "—"}
              {c.sector_flag && " ⚑ concentration to review"}
            </dd>
          </div>
        </dl>
      )}
      {c.findings.length > 0 && (
        <ul className="holdings-findings">
          {c.findings.map((f) => (
            <li key={f}>⚑ {f}</li>
          ))}
        </ul>
      )}
      <p className="money-basis">
        Shares are of valued holdings; the same symbol in several accounts
        counts as one position. This page marks a single position above{" "}
        {SINGLE_HOLDING_LIMIT_PCT}% or a sector above {SECTOR_LIMIT_PCT}% as a
        concentration to review. These are fixed reference levels for attention,
        not limits that suit everyone.
      </p>
    </Card>
  );
}

const CUSTOM = "custom";

export function MixCard({ p }: { p: Portfolio }) {
  const [choice, setChoice] = useState(REFERENCE_MIXES[2].id);
  const [custom, setCustom] = useState<Record<MixBucket, string>>(
    () =>
      Object.fromEntries(
        MIX_BUCKETS.map((b) => [
          b,
          b === "stocks" ? "60" : b === "bond" ? "40" : "0",
        ]),
      ) as Record<MixBucket, string>,
  );
  const customWeights: MixWeights = Object.fromEntries(
    MIX_BUCKETS.map((b) => [
      b,
      custom[b].trim() === "" ? 0 : Number(custom[b]),
    ]),
  );
  const preset = REFERENCE_MIXES.find((m) => m.id === choice);
  const weights = preset ? preset.weights : customWeights;
  const problems = preset ? [] : validateMix(customWeights);
  const rows = problems.length ? null : compareToMix(p, weights);

  return (
    <Card title="Compared with a reference mix">
      <p className="money-basis">
        Reference mixes are common textbook examples, shown only so you can see
        how your mix differs. U.S. and international stocks are combined as
        stocks. Nothing here says which mix to hold.
      </p>
      <div className="money-inline">
        <label>
          Reference mix
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {REFERENCE_MIXES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom percentages</option>
          </select>
        </label>
      </div>
      {!preset && (
        <fieldset className="money-splits holdings-mix">
          <legend>Custom percentages (whole numbers, total 100)</legend>
          {MIX_BUCKETS.map((b) => (
            <label key={b}>
              {MIX_BUCKET_LABELS[b]} (%)
              <input
                value={custom[b]}
                inputMode="numeric"
                onChange={(e) => setCustom({ ...custom, [b]: e.target.value })}
              />
            </label>
          ))}
        </fieldset>
      )}
      {problems.length > 0 && (
        <p className="money-warn" role="status">
          {problems.join(" ")}
        </p>
      )}
      {problems.length === 0 && rows == null && (
        <p className="money-basis">
          Needs at least one holding with a price and date.
        </p>
      )}
      {rows && (
        <div className="money-table-scroll">
          <table className="money-table holdings-alloc">
            <caption>Your valued holdings against the reference</caption>
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col">Yours</th>
                <th scope="col">Reference</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <th scope="row">{r.label}</th>
                  <td>{pct(r.actual_pct)}</td>
                  <td>{pct(r.reference_pct)}</td>
                  <td>{pp(r.difference_pp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
