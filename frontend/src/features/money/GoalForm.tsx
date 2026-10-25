import { useId, useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import {
  isIsoDate,
  isLiability,
  newId,
  parseMoney,
  type Account,
} from "./model";
import { GOAL_KIND_LABELS, type Goal, type GoalKind } from "./planning";

function centsText(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/** Add or edit one goal. Every Goal field is editable; nothing is guessed. */
export function GoalForm({
  initial,
  accounts,
  onSave,
  onCancel,
}: {
  initial: Goal | null;
  accounts: Account[];
  onSave: (goal: Goal) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<GoalKind>(initial?.kind ?? "custom");
  const [target, setTarget] = useState(centsText(initial?.target_cents));
  const [funded, setFunded] = useState(centsText(initial?.funded_cents ?? 0));
  const [linked, setLinked] = useState<string[]>(
    initial?.linked_account_ids ?? [],
  );
  const [date, setDate] = useState(initial?.target_date ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? 3));
  const [monthly, setMonthly] = useState(
    centsText(initial?.monthly_contribution_cents),
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const noteId = useId();
  const linkable = accounts.filter((a) => !a.archived && !isLiability(a));

  const toggle = (id: string) =>
    setLinked((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    const targetCents = parseMoney(target);
    const fundedCents = funded.trim() === "" ? 0 : parseMoney(funded);
    const monthlyCents = monthly.trim() === "" ? null : parseMoney(monthly);
    if (!name.trim()) problems.push("Give the goal a name.");
    if (targetCents === null || targetCents <= 0)
      problems.push("Enter a target amount greater than zero, e.g. 5000.00.");
    if (fundedCents === null)
      problems.push("Amount set aside must be an amount such as 250.00.");
    if (monthly.trim() !== "" && monthlyCents === null)
      problems.push("Monthly contribution must be an amount such as 200.00.");
    if (date !== "" && !isIsoDate(date))
      problems.push("Enter a valid target date or leave it empty.");
    setErrors(problems);
    if (problems.length) return;
    onSave({
      id: initial?.id ?? newId(),
      name: name.trim(),
      kind,
      target_cents: targetCents as number,
      funded_cents: fundedCents as number,
      linked_account_ids: linked,
      target_date: date === "" ? null : date,
      priority: Number(priority),
      monthly_contribution_cents: monthlyCents,
      description: description.trim(),
    });
  };

  return (
    <Card title={initial ? `Edit ${initial.name}` : "Add a goal"}>
      <form className="money-form" onSubmit={submit} noValidate>
        <label>
          Goal name
          <input
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Kind of goal
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as GoalKind)}
          >
            {Object.entries(GOAL_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target amount
          <input
            value={target}
            inputMode="decimal"
            placeholder="0.00"
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label>
          Amount already set aside
          <input
            value={funded}
            inputMode="decimal"
            placeholder="0.00"
            disabled={linked.length > 0}
            aria-describedby={noteId}
            onChange={(e) => setFunded(e.target.value)}
          />
        </label>
        <p id={noteId} className="money-sub money-form__wide">
          {linked.length > 0
            ? "Linked accounts are used instead: their settled balances count as set aside."
            : "Used only when no account is linked below."}
        </p>
        <fieldset className="money-splits money-form__wide">
          <legend>Accounts that hold this goal&rsquo;s money (optional)</legend>
          {linkable.length === 0 ? (
            <p className="money-sub">No savings or other asset accounts yet.</p>
          ) : (
            linkable.map((a) => (
              <label key={a.id} className="money-check">
                <input
                  type="checkbox"
                  checked={linked.includes(a.id)}
                  onChange={() => toggle(a.id)}
                />
                {a.name}
              </label>
            ))
          )}
        </fieldset>
        <label>
          Target date (optional)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="1">1 (highest)</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5 (lowest)</option>
          </select>
        </label>
        <label>
          Planned monthly contribution (optional)
          <input
            value={monthly}
            inputMode="decimal"
            placeholder="Not decided"
            onChange={(e) => setMonthly(e.target.value)}
          />
        </label>
        <label className="money-form__wide">
          Notes (optional)
          <textarea
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {errors.length > 0 && (
          <div className="money-form__wide">
            <Callout tone="error" role="alert">
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        <div className="money-actions money-form__wide">
          <Button type="submit" variant="primary">
            Save goal
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
