import { useState, type FormEvent } from "react";

import { Button, Callout, Card, Stat } from "../../components/ui";
import { BudgetInsights } from "./BudgetInsights";
import "./budgets.css";
import {
  budgetReport,
  FIXED_DEFINITION,
  NEAR_THRESHOLD,
  type BudgetRow,
  type BudgetStatus,
  type Projection,
} from "./budgets";
import {
  formatCents,
  newId,
  parseMoney,
  todayIso,
  type MoneyState,
} from "./model";
import type { Budget, PlanningState } from "./planning";
import { RecurringPanel } from "./RecurringPanel";

export type PlanningUpdate = (fn: (p: PlanningState) => PlanningState) => void;

const STATUS_TEXT: Record<BudgetStatus, string> = {
  under: "✓ Under",
  near: "! Near limit",
  over: "▲ Over",
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function projectionText(p: Projection): string {
  return p.cents === null
    ? `— (${p.reason ?? "unavailable"})`
    : formatCents(p.cents);
}

/**
 * Budgets for one month, recurring items, and patterns found in the user's own
 * records. Every figure states its basis; nothing is a forecast or advice.
 */
export function BudgetsView({
  state,
  onPlanning,
}: {
  state: MoneyState;
  onPlanning: PlanningUpdate;
}) {
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const planning = state.planning;
  const validMonth = MONTH_RE.test(month);
  const report = validMonth
    ? budgetReport(state, planning, month, today)
    : null;

  const saveBudget = (b: Budget) => {
    onPlanning((p) => ({
      ...p,
      budgets: p.budgets.some((x) => x.id === b.id)
        ? p.budgets.map((x) => (x.id === b.id ? b : x))
        : [...p.budgets, b],
    }));
    setEditing(null);
  };
  const deleteBudget = (id: string) =>
    onPlanning((p) => ({
      ...p,
      budgets: p.budgets.filter((b) => b.id !== id),
    }));

  return (
    <>
      <Card title="Budgets">
        <div className="money-inline">
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        </div>
        {!report ? (
          <Callout tone="error" role="alert">
            Choose a month, for example {today.slice(0, 7)}.
          </Callout>
        ) : (
          <>
            <p className="money-basis">
              {report.period.through
                ? `Actual spending is settled spending from ${report.period.start} through ${report.period.through} (${report.period.days_elapsed} of ${report.period.days_in_month} days). Pending transactions are not counted.`
                : `${month} has not started; nothing is counted as spent yet.`}
            </p>
            <div className="money-stats">
              <Stat
                label="Income"
                value={formatCents(report.income_cents)}
                note="Settled, this month to date"
              />
              <Stat
                label="Spending"
                value={formatCents(report.spending_cents)}
                note="Expenses + interest − refunds"
              />
              <Stat
                label="Income − spending"
                value={formatCents(report.net_cents)}
              />
              <Stat
                label="Fixed spending"
                value={formatCents(report.fixed_cents)}
                note={`Categories: ${report.fixed_categories.join(", ") || "none"}`}
              />
              <Stat
                label="Variable spending"
                value={formatCents(report.variable_cents)}
              />
              <Stat
                label="Spending without a budget"
                value={formatCents(report.unbudgeted_total_cents)}
                note={
                  report.unbudgeted.length
                    ? report.unbudgeted
                        .map((u) => `${u.category} ${formatCents(u.cents)}`)
                        .join(", ")
                    : "None"
                }
              />
            </div>
            <p className="money-basis">{FIXED_DEFINITION}</p>
            <BudgetTable
              rows={report.rows}
              onEdit={(b) => setEditing(b)}
              onDelete={deleteBudget}
            />
            <p className="money-basis">
              Status: “Near limit” from {percent(NEAR_THRESHOLD)} of the limit;
              “Over” above 100%. Two month-end estimates, neither a forecast:
              <strong> pace</strong> = spent so far ÷ days elapsed × days in the
              month (assumes the pace so far continues);{" "}
              <strong>scheduled</strong> = spent so far + recurring expenses in
              the category still due this month (assumes only those happen).
            </p>
          </>
        )}
        <div className="money-actions budgets-gap">
          {editing === null && (
            <Button small onClick={() => setEditing("new")}>
              Add budget
            </Button>
          )}
        </div>
        {editing !== null && (
          <BudgetForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            categories={state.categories}
            defaultMonth={validMonth ? month : today.slice(0, 7)}
            onSave={saveBudget}
            onCancel={() => setEditing(null)}
          />
        )}
      </Card>
      <RecurringPanel state={state} onPlanning={onPlanning} today={today} />
      <BudgetInsights state={state} onPlanning={onPlanning} today={today} />
    </>
  );
}

function BudgetTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: BudgetRow[];
  onEdit: (b: Budget) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (rows.length === 0) {
    return <p className="money-basis">No budgets apply to this month yet.</p>;
  }
  return (
    <div className="money-table-scroll">
      <table className="money-table budgets-table">
        <caption>Budget and actual spending</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Limit</th>
            <th scope="col">Spent</th>
            <th scope="col">Remaining</th>
            <th scope="col">Used</th>
            <th scope="col">Status</th>
            <th scope="col">Month end at this pace</th>
            <th scope="col">Month end with scheduled items</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.budget.id}>
              <th scope="row">{r.category}</th>
              <td>{formatCents(r.limit_cents)}</td>
              <td>{formatCents(r.actual_cents)}</td>
              <td className={r.remaining_cents < 0 ? "money-negative" : ""}>
                {formatCents(r.remaining_cents)}
              </td>
              <td>{percent(r.percent_used)}</td>
              <td className={r.status === "over" ? "money-negative" : ""}>
                {STATUS_TEXT[r.status]}
              </td>
              <td>{projectionText(r.run_rate)}</td>
              <td>
                {projectionText(r.scheduled)}
                {r.scheduled_count > 0 && (
                  <span className="money-sub">
                    includes {r.scheduled_count} due (
                    {formatCents(r.scheduled_remaining_cents)})
                    {r.scheduled_estimated_count > 0 &&
                      `, ${r.scheduled_estimated_count} estimated`}
                  </span>
                )}
              </td>
              <td>
                <div className="money-actions budgets-actions">
                  <Button
                    small
                    variant="ghost"
                    aria-label={`Edit ${r.category} budget`}
                    onClick={() => onEdit(r.budget)}
                  >
                    Edit
                  </Button>
                  {confirming === r.budget.id ? (
                    <>
                      <Button
                        small
                        aria-label={`Confirm delete ${r.category} budget`}
                        onClick={() => onDelete(r.budget.id)}
                      >
                        Delete
                      </Button>
                      <Button
                        small
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      small
                      variant="ghost"
                      aria-label={`Delete ${r.category} budget`}
                      onClick={() => setConfirming(r.budget.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetForm({
  initial,
  categories,
  defaultMonth,
  onSave,
  onCancel,
}: {
  initial: Budget | null;
  categories: string[];
  defaultMonth: string;
  onSave: (b: Budget) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(
    initial?.category ?? categories[0] ?? "",
  );
  const [limit, setLimit] = useState(
    initial ? (initial.limit_cents / 100).toFixed(2) : "",
  );
  const [start, setStart] = useState(initial?.start_month ?? defaultMonth);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    const cents = parseMoney(limit);
    if (!category) problems.push("Choose a category.");
    if (cents === null || cents <= 0)
      problems.push("Enter a monthly limit greater than zero, e.g. 400.00.");
    if (!MONTH_RE.test(start)) problems.push("Enter a valid starting month.");
    setErrors(problems);
    if (problems.length) return;
    onSave({
      id: initial?.id ?? newId(),
      category,
      limit_cents: cents as number,
      start_month: start,
    });
  };

  return (
    <form
      className="money-form budgets-form"
      onSubmit={submit}
      noValidate
      aria-label={initial ? `Edit ${initial.category} budget` : "Add a budget"}
    >
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Monthly limit
        <input
          value={limit}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => setLimit(e.target.value)}
        />
      </label>
      <label>
        Applies from month
        <input
          type="month"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      {errors.length > 0 && (
        <div className="money-form__wide">
          <Callout tone="error" role="alert">
            {errors.join(" ")}
          </Callout>
        </div>
      )}
      <div className="money-actions money-form__wide">
        <Button type="submit" variant="primary">
          Save budget
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
