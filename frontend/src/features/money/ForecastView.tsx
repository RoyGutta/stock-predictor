import { useId, useState } from "react";

import { Callout, Card, Stat } from "../../components/ui";
import {
  HORIZONS,
  projectCashFlow,
  type Forecast,
  type Horizon,
} from "./forecast";
import { formatCents, parseMoney, todayIso, type MoneyState } from "./model";
import "./planning-views.css";

const KIND_LABEL = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  goal_contribution: "Goal contribution",
} as const;

/**
 * Projected liquid funds from the user's own recurring entries. Deterministic
 * arithmetic, labelled as such; confirmed balances are kept apart from
 * projected ones.
 */
export function ForecastView({ state }: { state: MoneyState }) {
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [threshold, setThreshold] = useState("");
  const [withGoals, setWithGoals] = useState(false);
  const today = todayIso();

  if (state.accounts.length === 0) {
    return (
      <Card title="Cash-flow projection">
        <p className="money-basis">
          Add an account first: the projection starts from your settled
          balances.
        </p>
      </Card>
    );
  }

  const thresholdCents = threshold.trim() === "" ? null : parseMoney(threshold);
  const f = projectCashFlow(state, {
    asOf: today,
    horizonDays: horizon,
    thresholdCents,
    includeGoalContributions: withGoals,
  });

  return (
    <>
      <Card title="Cash-flow projection">
        <p className="money-basis plan-statement">
          A deterministic projection from your own entries, not a prediction:
          today&rsquo;s settled balances plus the recurring items you entered,
          applied on their dates. Nothing else is assumed.
        </p>
        <div className="money-inline">
          <label>
            Horizon
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value) as Horizon)}
            >
              {HORIZONS.map((h) => (
                <option key={h} value={h}>
                  {h} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Threshold for liquid funds (optional)
            <input
              value={threshold}
              inputMode="decimal"
              placeholder="Not set"
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <label className="money-check">
            <input
              type="checkbox"
              checked={withGoals}
              onChange={(e) => setWithGoals(e.target.checked)}
            />
            Include planned goal contributions
          </label>
        </div>
        {threshold.trim() !== "" && thresholdCents === null && (
          <p className="money-warn" role="status">
            Enter the amount as a number such as 500.00.
          </p>
        )}
        <Summary f={f} />
      </Card>
      <Card title="Projected liquid funds">
        <ProjectionChart f={f} />
        <AccountsTable f={f} />
      </Card>
      <EventsCard f={f} />
    </>
  );
}

function Summary({ f }: { f: Forecast }) {
  return (
    <>
      {f.first_below_zero && (
        <Callout tone="error">
          <strong>
            <span aria-hidden="true">! </span>Projected shortfall on{" "}
            {f.first_below_zero}.
          </strong>{" "}
          Liquid funds fall below $0.00 on that date and reach{" "}
          {formatCents(f.lowest.cents)} on {f.lowest.date}.
        </Callout>
      )}
      {f.threshold_cents != null && f.first_below_threshold && (
        <Callout tone="accent">
          <span aria-hidden="true">! </span>Liquid funds fall below your
          threshold of {formatCents(f.threshold_cents)} on{" "}
          {f.first_below_threshold}.
        </Callout>
      )}
      <div className="money-stats">
        <Stat
          label="Liquid funds today (confirmed)"
          value={formatCents(f.confirmed_liquid_cents)}
          note="Settled balances only"
        />
        <Stat
          label="Lowest projected"
          value={formatCents(f.lowest.cents)}
          note={`On ${f.lowest.date}`}
          tone={f.lowest.cents < 0 ? "negative" : undefined}
        />
        <Stat
          label={`Left after obligations, ${f.end_date}`}
          value={formatCents(f.money_left_cents)}
          note={`In ${formatCents(f.inflow_cents)}, out ${formatCents(f.outflow_cents)}`}
        />
        <Stat
          label="Shortfall date"
          value={f.first_below_zero ?? "None in this horizon"}
          note="First day below $0.00"
        />
      </div>
      {f.pending.transactions.length > 0 && (
        <p className="money-basis">
          {f.pending.transactions.length} pending transaction
          {f.pending.transactions.length === 1 ? " is" : "s are"} not in the
          confirmed balance or the projection. Together they would change liquid
          funds by {formatCents(f.pending.liquid_effect_cents)} once settled.
        </p>
      )}
      <p className="money-basis">
        {f.events.length} projected event{f.events.length === 1 ? "" : "s"}:{" "}
        {f.fixed_count} fixed (amount known), {f.estimated_count} estimated
        (amount varies; the figure you entered is used).{" "}
        {f.goal_contributions_included
          ? "Planned goal contributions are included on the first of each month; one into a linked cash account stays in liquid funds."
          : "Goal contributions are not included."}{" "}
        Liquid funds are cash, checking, savings, and money market accounts in
        U.S. dollars.
      </p>
      {f.skipped.length > 0 && (
        <p className="money-basis">Left out: {f.skipped.join("; ")}.</p>
      )}
    </>
  );
}

const W = 600;
const H = 200;
const PAD = 8;

function ProjectionChart({ f }: { f: Forecast }) {
  const titleId = useId();
  const descId = useId();
  const values = f.daily.map((p) => p.liquid_cents);
  const extras = [0, ...(f.threshold_cents != null ? [f.threshold_cents] : [])];
  const min = Math.min(...values, ...extras);
  const max = Math.max(...values, ...extras);
  const span = max - min || 1;
  const x = (i: number) =>
    PAD + (i / Math.max(1, values.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + ((max - v) / span) * (H - 2 * PAD);
  // A step line: balances change on event days and hold in between.
  const points = values
    .map((v, i) =>
      i === 0
        ? `${x(0)},${y(v)}`
        : `${x(i)},${y(values[i - 1])} ${x(i)},${y(v)}`,
    )
    .join(" ");
  const end = f.daily[f.daily.length - 1];

  return (
    <figure className="plan-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
      >
        <title id={titleId}>
          Projected liquid funds, {f.as_of} to {f.end_date}
        </title>
        <desc id={descId}>
          Starts at {formatCents(f.confirmed_liquid_cents)} confirmed, lowest{" "}
          {formatCents(f.lowest.cents)} on {f.lowest.date}, ends at{" "}
          {formatCents(end.liquid_cents)} on {end.date}.
          {f.first_below_zero
            ? ` Falls below zero on ${f.first_below_zero}.`
            : " Stays at or above zero."}
        </desc>
        <line
          className="plan-chart__zero"
          x1={PAD}
          x2={W - PAD}
          y1={y(0)}
          y2={y(0)}
        />
        {f.threshold_cents != null && (
          <line
            className="plan-chart__threshold"
            x1={PAD}
            x2={W - PAD}
            y1={y(f.threshold_cents)}
            y2={y(f.threshold_cents)}
          />
        )}
        <polyline className="plan-chart__line" points={points} />
      </svg>
      <figcaption className="money-sub">
        Solid line: projected liquid funds at the end of each day. Dotted line:
        $0.00{f.threshold_cents != null ? "; dashed line: your threshold" : ""}.
        Exact figures are in the tables below.
      </figcaption>
    </figure>
  );
}

function AccountsTable({ f }: { f: Forecast }) {
  return (
    <div className="money-table-scroll">
      <table className="money-table">
        <caption>
          Each account: confirmed today and projected on {f.end_date}
        </caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Confirmed today</th>
            <th scope="col">Projected</th>
          </tr>
        </thead>
        <tbody>
          {f.accounts.map((a) => (
            <tr key={a.account_id}>
              <th scope="row">
                {a.name}
                <span className="money-sub">
                  {a.liability
                    ? "Debt (amount owed)"
                    : a.liquid
                      ? "Liquid"
                      : "Not liquid"}
                </span>
              </th>
              <td>{formatCents(a.confirmed_cents)}</td>
              <td>{formatCents(a.projected_end_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="money-sub">
        Per-account figures exclude goal contributions, which are not tied to
        one account.
      </p>
    </div>
  );
}

function EventsCard({ f }: { f: Forecast }) {
  return (
    <Card title="Upcoming projected events">
      {f.events.length === 0 ? (
        <p className="money-basis">
          No recurring items fall in the next {f.horizon_days} days, so the
          projection stays at today&rsquo;s confirmed balance.
        </p>
      ) : (
        <div className="money-table-scroll">
          <table className="money-table plan-events">
            <caption>
              Projected events, {f.as_of} to {f.end_date}
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Item</th>
                <th scope="col">Basis</th>
                <th scope="col">Liquid change</th>
                <th scope="col">Liquid after</th>
              </tr>
            </thead>
            <tbody>
              {f.events.map((e, i) => (
                <tr key={`${e.source_id}-${e.date}-${i}`}>
                  <th scope="row">{e.date}</th>
                  <td>
                    {e.description}
                    <span className="money-sub">
                      {KIND_LABEL[e.kind]} · {formatCents(e.amount_cents)}
                    </span>
                  </td>
                  <td>
                    <span className="money-tag">
                      {e.certainty === "fixed" ? "Fixed" : "Estimated"}
                    </span>
                  </td>
                  <td>{formatCents(e.liquid_delta_cents)}</td>
                  <td
                    className={
                      e.liquid_after_cents < 0 ? "money-negative" : undefined
                    }
                  >
                    {e.liquid_after_cents < 0 && (
                      <span className="visually-hidden">Below zero: </span>
                    )}
                    {formatCents(e.liquid_after_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
