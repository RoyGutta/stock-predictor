import { useState } from "react";

import { Button, Card, Stat } from "../../components/ui";
import { formatPercentPlain } from "../../lib/format";
import { GoalForm } from "./GoalForm";
import {
  compareScenario,
  feasibility,
  goalProgress,
  projectWithReturn,
  type GoalProgress,
  type GoalStatusCode,
} from "./goals";
import {
  formatCents,
  isIsoDate,
  parseMoney,
  todayIso,
  type MoneyState,
} from "./model";
import { GOAL_KIND_LABELS, type Goal, type PlanningState } from "./planning";
import "./planning-views.css";

type OnPlanning = (fn: (p: PlanningState) => PlanningState) => void;

/** Text glyphs so status never rests on color alone. */
const STATUS_GLYPH: Record<GoalStatusCode, string> = {
  reached: "✓",
  on_track: "✓",
  behind: "!",
  past_due: "!",
  no_date: "–",
  no_plan: "–",
};

function months(n: number | null): string {
  return n == null ? "—" : `${n} month${n === 1 ? "" : "s"}`;
}

export function GoalsView({
  state,
  onPlanning,
}: {
  state: MoneyState;
  onPlanning: OnPlanning;
}) {
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const today = todayIso();
  const goals = state.planning.goals;
  const rows = goals
    .map((g) => goalProgress(g, state, today))
    .sort((a, b) => a.goal.priority - b.goal.priority);

  const save = (goal: Goal) => {
    onPlanning((p) => ({
      ...p,
      goals: p.goals.some((g) => g.id === goal.id)
        ? p.goals.map((g) => (g.id === goal.id ? goal : g))
        : [...p.goals, goal],
    }));
    setEditing(null);
  };
  const remove = (id: string) =>
    onPlanning((p) => ({ ...p, goals: p.goals.filter((g) => g.id !== id) }));

  return (
    <>
      {editing !== null && (
        <GoalForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          accounts={state.accounts}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      <Card
        title="Goals"
        action={
          editing === null ? (
            <Button small onClick={() => setEditing("new")}>
              Add goal
            </Button>
          ) : undefined
        }
      >
        {rows.length === 0 ? (
          <p className="money-basis">
            No goals yet. A goal needs a name and a target amount; a date and a
            monthly amount let it be checked against your records.
          </p>
        ) : (
          <ul className="money-list">
            {rows.map((p) => (
              <GoalRow
                key={p.goal.id}
                p={p}
                onEdit={() => setEditing(p.goal)}
                onDelete={() => remove(p.goal.id)}
              />
            ))}
          </ul>
        )}
        <p className="money-basis">
          Required per month = amount remaining ÷ whole calendar months from
          today ({today}) to the target date, rounded up to the cent. No
          investment return is assumed. Linked accounts count with their settled
          balances; pending transactions are not included.
        </p>
      </Card>
      {rows.length > 0 && <FeasibilityCard state={state} today={today} />}
      {rows.length > 0 && <ScenarioCard state={state} today={today} />}
    </>
  );
}

function GoalRow({
  p,
  onEdit,
  onDelete,
}: {
  p: GoalProgress;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const g = p.goal;
  const behind = p.status === "behind" || p.status === "past_due";
  return (
    <li className="money-item">
      <div className="money-item__head">
        <div>
          <p className="money-item__name">
            {g.name}
            <span className="money-tag">Priority {g.priority}</span>
          </p>
          <p className="money-sub">
            {GOAL_KIND_LABELS[g.kind]}
            {g.target_date ? ` · by ${g.target_date}` : " · no target date"}
          </p>
        </div>
        <p className="money-item__amount">
          {formatCents(p.funded_cents)} of {formatCents(g.target_cents)}
          <span className="money-sub">
            {p.funded_basis === "linked_accounts"
              ? "from linked accounts"
              : "entered by you"}
          </span>
        </p>
      </div>
      <div className="plan-progress">
        <progress
          max={1}
          value={p.progress}
          aria-label={`${g.name} progress`}
        />
        <span>{formatPercentPlain(p.progress, 0)} funded</span>
      </div>
      <dl className="plan-facts">
        <div>
          <dt>Remaining</dt>
          <dd>{formatCents(p.remaining_cents)}</dd>
        </div>
        <div>
          <dt>Required per month</dt>
          <dd>
            {p.required_monthly_cents == null
              ? "—"
              : formatCents(p.required_monthly_cents)}
            <span className="money-sub">
              {p.required_reason ?? months(p.months_to_target)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Planned per month</dt>
          <dd>
            {g.monthly_contribution_cents == null
              ? "Not decided"
              : formatCents(g.monthly_contribution_cents)}
          </dd>
        </div>
        <div>
          <dt>Reached at the planned amount</dt>
          <dd>
            {p.completion_date ?? "—"}
            <span className="money-sub">
              {p.completion_reason ?? months(p.completion_months)}
            </span>
          </dd>
        </div>
      </dl>
      <p className={behind ? "money-warn" : "money-sub"}>
        <span aria-hidden="true">{STATUS_GLYPH[p.status]} </span>
        {p.status_text}
      </p>
      {p.funded_notes.map((n) => (
        <p key={n} className="money-sub">
          {n}
        </p>
      ))}
      {g.description && <p className="money-sub">{g.description}</p>}
      <div className="money-actions">
        <Button
          small
          variant="ghost"
          onClick={onEdit}
          aria-label={`Edit ${g.name}`}
        >
          Edit
        </Button>
        {confirming ? (
          <>
            <span className="money-warn">Delete {g.name}?</span>
            <Button small onClick={onDelete}>
              Delete
            </Button>
            <Button small variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            small
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${g.name}`}
          >
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

function FeasibilityCard({
  state,
  today,
}: {
  state: MoneyState;
  today: string;
}) {
  const f = feasibility(state, today);
  return (
    <Card title="Goals together">
      <div className="money-stats">
        <Stat
          label="Average monthly surplus"
          value={formatCents(f.average_surplus_cents)}
          note={
            f.months.length
              ? `Income ${formatCents(f.average_income_cents)} − spending ${formatCents(f.average_spending_cents)}, ${f.months.length} complete month${f.months.length === 1 ? "" : "s"} (${f.months[0]} to ${f.months[f.months.length - 1]})`
              : "Needs a complete month of records"
          }
        />
        <Stat
          label="Recurring commitments not in spending"
          value={formatCents(f.commitments_cents)}
          note="Monthly equivalent"
        />
        <Stat
          label="Available for goals"
          value={formatCents(f.available_cents)}
          note={f.available_reason ?? "Surplus − commitments"}
        />
        <Stat
          label="Goals need"
          value={formatCents(f.total_needed_cents)}
          note="Per month, all assessed goals"
        />
      </div>
      <div className="money-table-scroll">
        <table className="money-table">
          <caption>Goals checked in priority order</caption>
          <thead>
            <tr>
              <th scope="col">Goal</th>
              <th scope="col">Needs / month</th>
              <th scope="col">Running total</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.progress.goal.id}>
                <th scope="row">
                  {r.progress.goal.name}
                  <span className="money-sub">
                    Priority {r.progress.goal.priority}
                  </span>
                </th>
                <td>
                  {formatCents(r.needed_cents)}
                  {r.needed_basis && (
                    <span className="money-sub">
                      {r.needed_basis === "required"
                        ? "required by date"
                        : "planned amount"}
                    </span>
                  )}
                </td>
                <td>{formatCents(r.cumulative_cents)}</td>
                <td className="plan-result">
                  {r.fits === true && (
                    <>
                      <span aria-hidden="true">✓ </span>Fits
                    </>
                  )}
                  {r.fits === false && (
                    <span className="money-negative">
                      <span aria-hidden="true">! </span>Conflict: short{" "}
                      {formatCents(r.shortfall_cents)} a month
                    </span>
                  )}
                  <span className="money-sub">{r.note}</span>
                  {r.fits_by_date && (
                    <span className="money-sub">
                      With what is left after higher priorities, it would be
                      reached by {r.fits_by_date}.
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.commitments.length > 0 && (
        <ul className="money-basis">
          {f.commitments.map((c) => (
            <li key={c.item.id}>
              {c.item.description}: {formatCents(c.monthly_cents)} a month (
              {c.item.certainty}). {c.reason}.
            </li>
          ))}
        </ul>
      )}
      <p className="money-basis">
        Each goal is checked assuming every higher-priority goal is funded in
        full first. Goals with a date use the amount required by that date;
        goals without one use the planned amount. The surplus is an average of
        past months, not a promise about future months. A recurring expense
        counts as a commitment only when no matching expense (same category and
        amount, or same description) appears in those months.
      </p>
    </Card>
  );
}

function ScenarioCard({ state, today }: { state: MoneyState; today: string }) {
  const goals = state.planning.goals;
  const [goalId, setGoalId] = useState(goals[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const goal = goals.find((g) => g.id === goalId) ?? goals[0];
  if (!goal) return null;
  const amountCents = amount.trim() === "" ? undefined : parseMoney(amount);
  const change = {
    ...(date !== "" && isIsoDate(date) ? { target_date: date } : {}),
    ...(amountCents != null ? { monthly_contribution_cents: amountCents } : {}),
  };
  const { current, scenario } = compareScenario(goal, change, state, today);
  const contribution = scenario.goal.monthly_contribution_cents;
  const rateValue = rate.trim() === "" ? null : Number(rate);
  const hypo =
    rateValue == null || contribution == null
      ? null
      : projectWithReturn(scenario.remaining_cents, contribution, rateValue);

  return (
    <Card title="What if">
      <div className="money-inline">
        <label>
          Goal
          <select value={goal.id} onChange={(e) => setGoalId(e.target.value)}>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Different target date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Different monthly amount
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Hypothetical annual return, % (hypothetical, not expected)
          <input
            value={rate}
            inputMode="decimal"
            placeholder="None"
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
      </div>
      {amount.trim() !== "" && amountCents == null && (
        <p className="money-warn" role="status">
          Enter the monthly amount as a number such as 250.00.
        </p>
      )}
      <div className="plan-compare">
        <Outcome title="As entered" p={current} />
        <Outcome title="With the change" p={scenario} />
      </div>
      {hypo && (
        <div className="plan-hypothetical" role="status">
          <p>
            <strong>Hypothetical, not expected:</strong>{" "}
            {hypo.months == null
              ? hypo.reason
              : `${months(hypo.months)} at ${formatCents(contribution)} a month, of which ${formatCents(hypo.growth_cents)} would be assumed growth.`}
          </p>
          <p className="money-sub">
            {hypo.basis} Returns vary and can be negative.
          </p>
        </div>
      )}
    </Card>
  );
}

function Outcome({ title, p }: { title: string; p: GoalProgress }) {
  return (
    <section className="plan-outcome" aria-label={title}>
      <h3 className="money-subtitle">{title}</h3>
      <dl className="plan-facts">
        <div>
          <dt>Target date</dt>
          <dd>{p.goal.target_date ?? "None"}</dd>
        </div>
        <div>
          <dt>Required per month</dt>
          <dd>
            {p.required_monthly_cents == null
              ? "—"
              : formatCents(p.required_monthly_cents)}
          </dd>
        </div>
        <div>
          <dt>Planned per month</dt>
          <dd>{formatCents(p.goal.monthly_contribution_cents)}</dd>
        </div>
        <div>
          <dt>Reached at the planned amount</dt>
          <dd>{p.completion_date ?? p.completion_reason ?? "—"}</dd>
        </div>
      </dl>
      <p className="money-sub">
        <span aria-hidden="true">{STATUS_GLYPH[p.status]} </span>
        {p.status_text}
      </p>
    </section>
  );
}
