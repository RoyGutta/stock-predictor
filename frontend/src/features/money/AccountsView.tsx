import { useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { balances, reconcile } from "./ledger";
import {
  ACCOUNT_TYPES,
  formatCents,
  isIsoDate,
  isLiability,
  newId,
  parseMoney,
  todayIso,
  type Account,
  type AccountType,
  type MoneyState,
} from "./model";

interface Props {
  state: MoneyState;
  onSave: (account: Account) => void;
  onDelete: (id: string) => void;
  startOpen?: boolean;
}

export function AccountsView({
  state,
  onSave,
  onDelete,
  startOpen = false,
}: Props) {
  const [editing, setEditing] = useState<Account | "new" | null>(
    startOpen ? "new" : null,
  );
  const today = todayIso();
  const current = balances(state, today);
  const count = (id: string) =>
    state.transactions.filter(
      (t) => t.account_id === id || t.to_account_id === id,
    ).length;

  return (
    <>
      {editing !== null && (
        <AccountForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(a) => {
            onSave(a);
            setEditing(null);
          }}
        />
      )}
      <Card
        title="Accounts"
        action={
          editing === null ? (
            <Button small onClick={() => setEditing("new")}>
              Add account
            </Button>
          ) : undefined
        }
      >
        {state.accounts.length === 0 ? (
          <p className="money-basis">No accounts yet.</p>
        ) : (
          <ul className="money-list">
            {state.accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                balance={current.get(a.id) ?? 0}
                transactions={count(a.id)}
                state={state}
                onEdit={() => setEditing(a)}
                onDelete={() => onDelete(a.id)}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AccountRow({
  account,
  balance,
  transactions,
  state,
  onEdit,
  onDelete,
}: {
  account: Account;
  balance: number;
  transactions: number;
  state: MoneyState;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [statement, setStatement] = useState("");
  const [statementDate, setStatementDate] = useState(todayIso());
  const parsed = parseMoney(statement, { allowNegative: true });
  const check =
    parsed !== null && isIsoDate(statementDate)
      ? reconcile(state, account.id, statementDate, parsed)
      : null;
  const info = ACCOUNT_TYPES[account.type];

  return (
    <li className="money-item">
      <div className="money-item__head">
        <div>
          <p className="money-item__name">
            {account.name}
            {account.archived && <span className="money-tag">Archived</span>}
          </p>
          <p className="money-sub">
            {info.label}
            {account.institution ? ` · ${account.institution}` : ""}
            {account.currency !== "USD"
              ? ` · ${account.currency} (not in totals)`
              : ""}
          </p>
        </div>
        <p className="money-item__amount">
          {formatCents(balance, account.currency)}
          <span className="money-sub">
            {isLiability(account) ? "owed" : "held"}
          </span>
        </p>
      </div>
      <details className="money-details">
        <summary>Check against a statement</summary>
        <div className="money-inline">
          <label>
            Statement balance
            <input
              value={statement}
              inputMode="decimal"
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
          <label>
            On
            <input
              type="date"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
            />
          </label>
        </div>
        {check && (
          <p className="money-basis" role="status">
            Recorded balance{" "}
            {formatCents(check.computed_cents, account.currency)}.{" "}
            {check.difference_cents === 0
              ? "It matches the statement."
              : `The statement differs by ${formatCents(check.difference_cents, account.currency)}: a transaction may be missing, duplicated, or still pending.`}
          </p>
        )}
      </details>
      <div className="money-actions">
        <Button small variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        {confirming ? (
          <>
            <span className="money-warn">
              Delete {account.name} and its {transactions} transaction
              {transactions === 1 ? "" : "s"}?
            </span>
            <Button small onClick={onDelete}>
              Delete
            </Button>
            <Button small variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button small variant="ghost" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
    </li>
  );
}

function optionalCents(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const v = parseMoney(text);
  return v === null ? "invalid" : v;
}

function AccountForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Account | null;
  onSave: (a: Account) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "checking");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [opening, setOpening] = useState(
    initial ? (initial.opening_balance_cents / 100).toFixed(2) : "",
  );
  const [openingDate, setOpeningDate] = useState(
    initial?.opening_date ?? todayIso(),
  );
  const [apr, setApr] = useState(
    initial?.apr != null ? String(initial.apr) : "",
  );
  const [minimum, setMinimum] = useState(
    initial?.minimum_payment_cents != null
      ? (initial.minimum_payment_cents / 100).toFixed(2)
      : "",
  );
  const [planned, setPlanned] = useState(
    initial?.planned_payment_cents != null
      ? (initial.planned_payment_cents / 100).toFixed(2)
      : "",
  );
  const [dueDay, setDueDay] = useState(
    initial?.due_day != null ? String(initial.due_day) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [errors, setErrors] = useState<string[]>([]);
  const liability = ACCOUNT_TYPES[type].side === "liability";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: string[] = [];
    const openingCents = parseMoney(opening, { allowNegative: true });
    if (!name.trim()) problems.push("Give the account a name.");
    if (openingCents === null)
      problems.push("Enter the balance as a number, e.g. 1250.00.");
    if (!isIsoDate(openingDate)) problems.push("Enter a valid balance date.");
    if (!/^[A-Z]{3}$/.test(currency))
      problems.push("Currency must be a three-letter code such as USD.");
    let aprValue: number | null = null;
    if (liability && apr.trim() !== "") {
      aprValue = Number(apr);
      if (!Number.isFinite(aprValue) || aprValue < 0 || aprValue > 100)
        problems.push("APR must be a percentage between 0 and 100.");
    }
    const min = liability ? optionalCents(minimum) : null;
    const plan = liability ? optionalCents(planned) : null;
    if (min === "invalid" || plan === "invalid")
      problems.push("Payments must be amounts such as 35.00.");
    const due = liability && dueDay.trim() !== "" ? Number(dueDay) : null;
    if (due !== null && (!Number.isInteger(due) || due < 1 || due > 31))
      problems.push("Due day must be between 1 and 31.");
    setErrors(problems);
    if (problems.length) return;
    onSave({
      id: initial?.id ?? newId(),
      name: name.trim(),
      type,
      currency,
      institution: institution.trim(),
      notes: notes.trim(),
      opening_balance_cents: openingCents as number,
      opening_date: openingDate,
      apr: aprValue,
      minimum_payment_cents: min as number | null,
      planned_payment_cents: plan as number | null,
      due_day: due,
      archived,
    });
  };

  return (
    <Card title={initial ? `Edit ${initial.name}` : "Add an account"}>
      <form className="money-form" onSubmit={submit} noValidate>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label>
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {Object.entries(ACCOUNT_TYPES).map(([key, info]) => (
              <option key={key} value={key}>
                {info.label} ({info.side === "asset" ? "asset" : "debt"})
              </option>
            ))}
          </select>
        </label>
        <label>
          {liability ? "Amount owed" : "Balance or value"}
          <input
            value={opening}
            inputMode="decimal"
            onChange={(e) => setOpening(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          As of
          <input
            type="date"
            value={openingDate}
            onChange={(e) => setOpeningDate(e.target.value)}
          />
        </label>
        <label>
          Currency
          <input
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Institution (optional)
          <input
            value={institution}
            maxLength={120}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </label>
        {liability && (
          <>
            <label>
              APR % (optional)
              <input
                value={apr}
                inputMode="decimal"
                onChange={(e) => setApr(e.target.value)}
                placeholder="Leave blank if unknown"
              />
            </label>
            <label>
              Minimum payment (optional)
              <input
                value={minimum}
                inputMode="decimal"
                onChange={(e) => setMinimum(e.target.value)}
              />
            </label>
            <label>
              Usual payment (optional)
              <input
                value={planned}
                inputMode="decimal"
                onChange={(e) => setPlanned(e.target.value)}
              />
            </label>
            <label>
              Due day of month (optional)
              <input
                value={dueDay}
                inputMode="numeric"
                onChange={(e) => setDueDay(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="money-form__wide">
          Notes (optional)
          <textarea
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {initial && (
          <label className="money-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Archived (kept, but left out of totals)
          </label>
        )}
        <p className="money-basis money-form__wide">
          {liability
            ? "The amount owed is the starting point; it is not counted as spending. Leave the rate or payments blank if you do not know them: estimates that need them will say so rather than assume zero."
            : "This starting balance is not counted as income. For investments, property, or vehicles, enter the value as of the date shown; update it later with a valuation."}
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
            Save account
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
