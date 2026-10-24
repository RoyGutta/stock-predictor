import { useMemo, useState } from "react";

import { Button, Card } from "../../components/ui";
import { TransactionForm } from "./TransactionForm";
import {
  KIND_LABELS,
  formatCents,
  type MoneyState,
  type Transaction,
} from "./model";

interface Props {
  state: MoneyState;
  onSave: (tx: Transaction) => void;
  onDelete: (id: string) => void;
  onAddCategory: (name: string) => void;
}

export function TransactionsView({
  state,
  onSave,
  onDelete,
  onAddCategory,
}: Props) {
  const [editing, setEditing] = useState<Transaction | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [kind, setKind] = useState("all");
  const [month, setMonth] = useState("");
  const names = useMemo(
    () => new Map(state.accounts.map((a) => [a.id, a])),
    [state.accounts],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.transactions
      .filter(
        (t) =>
          account === "all" ||
          t.account_id === account ||
          t.to_account_id === account,
      )
      .filter((t) => kind === "all" || t.kind === kind)
      .filter((t) => !month || t.date.startsWith(month))
      .filter(
        (t) =>
          !q ||
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }, [state.transactions, account, kind, month, query]);

  if (state.accounts.length === 0) {
    return (
      <Card title="Transactions">
        <p className="money-basis">
          Add an account first; every transaction belongs to one.
        </p>
      </Card>
    );
  }

  return (
    <>
      {editing !== null && (
        <TransactionForm
          key={editing === "new" ? "new" : editing.id}
          state={state}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onAddCategory={onAddCategory}
          onSave={(tx) => {
            onSave(tx);
            setEditing(null);
          }}
        />
      )}
      <Card
        title="Transactions"
        action={
          editing === null ? (
            <Button small onClick={() => setEditing("new")}>
              Add transaction
            </Button>
          ) : undefined
        }
      >
        <div className="money-filters" role="search">
          <label>
            Search transactions
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Description, category, note"
            />
          </label>
          <label>
            Filter by account
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="all">All accounts</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter by kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds</option>
              {Object.keys(KIND_LABELS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter by month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        </div>
        <p className="money-basis" role="status">
          {rows.length} of {state.transactions.length} transactions
        </p>
        {rows.length > 0 && (
          <ul className="money-list">
            {rows.slice(0, 300).map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                from={names.get(t.account_id)?.name ?? "?"}
                to={
                  t.to_account_id
                    ? (names.get(t.to_account_id)?.name ?? "?")
                    : null
                }
                currency={names.get(t.account_id)?.currency ?? "USD"}
                onEdit={() => setEditing(t)}
                onDelete={() => onDelete(t.id)}
              />
            ))}
          </ul>
        )}
        {rows.length > 300 && (
          <p className="money-basis">
            Showing the 300 most recent matches; narrow the filters to see
            others.
          </p>
        )}
      </Card>
    </>
  );
}

function TransactionRow({
  tx,
  from,
  to,
  currency,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  from: string;
  to: string | null;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const sign =
    tx.kind === "expense"
      ? "−"
      : tx.kind === "income" || tx.kind === "refund"
        ? "+"
        : "";
  return (
    <li className="money-item">
      <div className="money-item__head">
        <div>
          <p className="money-item__name">
            {tx.description || (
              <span className="money-sub">No description</span>
            )}
            {tx.status === "pending" && (
              <span className="money-tag">Pending</span>
            )}
          </p>
          <p className="money-sub">
            {tx.date} · {tx.kind} · {to ? `${from} → ${to}` : from} ·{" "}
            {tx.splits.length > 0
              ? tx.splits.map((s) => s.category).join(", ")
              : tx.category}
            {tx.interest_cents > 0 &&
              ` · ${formatCents(tx.interest_cents, currency)} interest`}
          </p>
        </div>
        <p className="money-item__amount">
          {sign}
          {formatCents(Math.abs(tx.amount_cents), currency)}
          {tx.kind === "valuation" && (
            <span className="money-sub">
              {tx.amount_cents < 0 ? "value down" : "value up"}
            </span>
          )}
        </p>
      </div>
      <div className="money-actions">
        <Button small variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        {confirming ? (
          <>
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
