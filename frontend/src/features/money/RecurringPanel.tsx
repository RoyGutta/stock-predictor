import { useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import type { PlanningUpdate } from "./BudgetsView";
import {
  formatCents,
  isIsoDate,
  newId,
  parseMoney,
  type MoneyState,
} from "./model";
import type { Cadence, RecurringItem } from "./planning";
import { CADENCE_LABELS, upcoming } from "./recurring";

const UPCOMING_DAYS = 30;

const KIND_TEXT: Record<RecurringItem["kind"], string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
};

/** Recurring items the user entered, and what is due in the next 30 days. */
export function RecurringPanel({
  state,
  onPlanning,
  today,
}: {
  state: MoneyState;
  onPlanning: PlanningUpdate;
  today: string;
}) {
  const [editing, setEditing] = useState<RecurringItem | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const items = state.planning.recurring;
  const names = new Map(state.accounts.map((a) => [a.id, a.name]));
  const due = upcoming(items, today, UPCOMING_DAYS);

  const save = (item: RecurringItem) => {
    onPlanning((p) => ({
      ...p,
      recurring: p.recurring.some((r) => r.id === item.id)
        ? p.recurring.map((r) => (r.id === item.id ? item : r))
        : [...p.recurring, item],
    }));
    setEditing(null);
  };
  const remove = (id: string) =>
    onPlanning((p) => ({
      ...p,
      recurring: p.recurring.filter((r) => r.id !== id),
    }));

  return (
    <>
      <Card
        title="Recurring items"
        action={
          editing === null ? (
            <Button
              small
              disabled={state.accounts.length === 0}
              onClick={() => setEditing("new")}
            >
              Add recurring item
            </Button>
          ) : undefined
        }
      >
        {state.accounts.length === 0 && (
          <p className="money-basis">Add an account first.</p>
        )}
        {editing !== null && (
          <RecurringForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            state={state}
            today={today}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        )}
        {items.length === 0 ? (
          <p className="money-basis">No recurring items yet.</p>
        ) : (
          <ul className="money-list">
            {items.map((r) => (
              <li key={r.id} className="money-item">
                <div className="money-item__head">
                  <div>
                    <p className="money-item__name">
                      {r.description || "(no description)"}
                      {r.essential && (
                        <span className="money-tag">Essential</span>
                      )}
                    </p>
                    <p className="money-sub">
                      {KIND_TEXT[r.kind]} · {CADENCE_LABELS[r.cadence]} ·{" "}
                      {r.category} ·{" "}
                      {names.get(r.account_id) ?? "Unknown account"}
                      {r.kind === "transfer" &&
                        ` → ${names.get(r.to_account_id ?? "") ?? "Unknown account"}`}
                      {" · "}next {r.next_date}
                      {r.end_date ? `, ends ${r.end_date}` : ""}
                    </p>
                  </div>
                  <p className="money-item__amount">
                    {formatCents(r.amount_cents)}
                    <span className="money-sub">
                      {r.certainty === "fixed"
                        ? "fixed amount"
                        : "estimated amount"}
                    </span>
                  </p>
                </div>
                <div className="money-actions">
                  <Button
                    small
                    variant="ghost"
                    aria-label={`Edit ${r.description}`}
                    onClick={() => setEditing(r)}
                  >
                    Edit
                  </Button>
                  {confirming === r.id ? (
                    <>
                      <span className="money-warn">
                        Delete {r.description}?
                      </span>
                      <Button small onClick={() => remove(r.id)}>
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
                      aria-label={`Delete ${r.description}`}
                      onClick={() => setConfirming(r.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Due in the next ${UPCOMING_DAYS} days`}>
        {due.length === 0 ? (
          <p className="money-basis">
            Nothing recurring is due from {today} through the next{" "}
            {UPCOMING_DAYS} days.
          </p>
        ) : (
          <ul className="money-list">
            {due.map((u) => (
              <li key={`${u.item.id}-${u.date}`} className="money-item">
                <div className="money-item__head">
                  <p>
                    <span className="money-item__name">{u.date}</span>{" "}
                    {u.item.description}
                    <span className="money-sub">
                      {KIND_TEXT[u.item.kind]} · {u.item.category}
                    </span>
                  </p>
                  <p className="money-item__amount">
                    {u.item.kind === "income" ? "+" : "−"}
                    {formatCents(u.item.amount_cents)}
                    {u.item.certainty === "estimated" && (
                      <span className="money-sub">estimated</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="money-basis">
          From the recurring items above, including today. Dates come from each
          item&rsquo;s next date and schedule; nothing is checked against your
          bank.
        </p>
      </Card>
    </>
  );
}

function RecurringForm({
  initial,
  state,
  today,
  onSave,
  onCancel,
}: {
  initial: RecurringItem | null;
  state: MoneyState;
  today: string;
  onSave: (r: RecurringItem) => void;
  onCancel: () => void;
}) {
  const accounts = state.accounts;
  const [description, setDescription] = useState(initial?.description ?? "");
  const [kind, setKind] = useState<RecurringItem["kind"]>(
    initial?.kind ?? "expense",
  );
  const [amount, setAmount] = useState(
    initial ? (initial.amount_cents / 100).toFixed(2) : "",
  );
  const [accountId, setAccountId] = useState(
    initial?.account_id ?? accounts[0]?.id ?? "",
  );
  const [toId, setToId] = useState(initial?.to_account_id ?? "");
  const [category, setCategory] = useState(
    initial?.category ?? state.categories[0] ?? "Uncategorized",
  );
  const [cadence, setCadence] = useState<Cadence>(
    initial?.cadence ?? "monthly",
  );
  const [nextDate, setNextDate] = useState(initial?.next_date ?? today);
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [certainty, setCertainty] = useState<RecurringItem["certainty"]>(
    initial?.certainty ?? "fixed",
  );
  const [essential, setEssential] = useState(initial?.essential ?? false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    const cents = parseMoney(amount);
    if (!description.trim()) problems.push("Add a description.");
    if (cents === null || cents <= 0)
      problems.push("Enter an amount greater than zero, e.g. 15.99.");
    if (!accounts.some((a) => a.id === accountId))
      problems.push("Choose an account.");
    if (kind === "transfer") {
      if (!accounts.some((a) => a.id === toId))
        problems.push("Choose the account receiving the transfer.");
      else if (toId === accountId)
        problems.push("A transfer needs two different accounts.");
    }
    if (!isIsoDate(nextDate)) problems.push("Enter a valid next date.");
    if (endDate && !isIsoDate(endDate))
      problems.push("Enter a valid end date.");
    else if (endDate && endDate < nextDate)
      problems.push("The end date must be on or after the next date.");
    setErrors(problems);
    if (problems.length) return;
    onSave({
      id: initial?.id ?? newId(),
      description: description.trim(),
      kind,
      amount_cents: cents as number,
      account_id: accountId,
      to_account_id: kind === "transfer" ? toId : null,
      category,
      cadence,
      next_date: nextDate,
      end_date: endDate || null,
      certainty,
      essential,
    });
  };

  return (
    <form
      className="money-form budgets-form"
      onSubmit={submit}
      noValidate
      aria-label={
        initial ? `Edit ${initial.description}` : "Add a recurring item"
      }
    >
      <label>
        Description
        <input
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label>
        Kind
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RecurringItem["kind"])}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer between your accounts</option>
        </select>
      </label>
      <label>
        Amount
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        {kind === "transfer" ? "From account" : "Account"}
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {kind === "transfer" && (
        <label>
          To account
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {state.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label>
        Repeats
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as Cadence)}
        >
          {Object.entries(CADENCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next due date
        <input
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
        />
      </label>
      <label>
        End date (optional, inclusive)
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </label>
      <label>
        Amount certainty
        <select
          value={certainty}
          onChange={(e) =>
            setCertainty(e.target.value as RecurringItem["certainty"])
          }
        >
          <option value="fixed">Fixed (same every time)</option>
          <option value="estimated">Estimated (varies)</option>
        </select>
      </label>
      <label className="money-check">
        <input
          type="checkbox"
          checked={essential}
          onChange={(e) => setEssential(e.target.checked)}
        />
        Essential (needed to live, such as rent or insurance)
      </label>
      <p className="money-basis money-form__wide">
        Monthly items keep their day of the month; on shorter months they fall
        on the last day (Jan 31 → Feb 28, or Feb 29 in a leap year).
      </p>
      {errors.length > 0 && (
        <div className="money-form__wide">
          <Callout tone="error" role="alert">
            {errors.join(" ")}
          </Callout>
        </div>
      )}
      <div className="money-actions money-form__wide">
        <Button type="submit" variant="primary">
          Save recurring item
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
