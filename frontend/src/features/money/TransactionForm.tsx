import { useState, type FormEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { validateTransaction } from "./ledger";
import {
  isLiability,
  newId,
  parseMoney,
  todayIso,
  type MoneyState,
  type Split,
  type Transaction,
  type TransactionKind,
  KIND_LABELS,
} from "./model";

/** Add or edit one transaction; validation comes from the ledger engine. */
export function TransactionForm({
  state,
  initial,
  onSave,
  onCancel,
  onAddCategory,
}: {
  state: MoneyState;
  initial: Transaction | null;
  onSave: (tx: Transaction) => void;
  onCancel: () => void;
  onAddCategory: (name: string) => void;
}) {
  const accounts = state.accounts.filter(
    (a) => !a.archived || a.id === initial?.account_id,
  );
  const [kind, setKind] = useState<TransactionKind>(initial?.kind ?? "expense");
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [amount, setAmount] = useState(
    initial ? (initial.amount_cents / 100).toFixed(2) : "",
  );
  const [accountId, setAccountId] = useState(
    initial?.account_id ?? accounts[0]?.id ?? "",
  );
  const [toId, setToId] = useState(initial?.to_account_id ?? "");
  const [interest, setInterest] = useState(
    initial?.interest_cents ? (initial.interest_cents / 100).toFixed(2) : "",
  );
  const [category, setCategory] = useState(
    initial?.category ?? "Uncategorized",
  );
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [pending, setPending] = useState(initial?.status === "pending");
  const [splits, setSplits] = useState<{ category: string; amount: string }[]>(
    initial?.splits.map((s) => ({
      category: s.category,
      amount: (s.amount_cents / 100).toFixed(2),
    })) ?? [],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const destination = state.accounts.find((a) => a.id === toId);
  const toDebt =
    kind === "transfer" &&
    destination !== undefined &&
    isLiability(destination);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoney(amount, { allowNegative: kind === "valuation" });
    const interestCents =
      toDebt && interest.trim() !== "" ? parseMoney(interest) : 0;
    const parsedSplits: Split[] = [];
    const problems: string[] = [];
    for (const s of splits) {
      const v = parseMoney(s.amount);
      if (v === null)
        problems.push("Each split needs an amount such as 12.50.");
      else parsedSplits.push({ category: s.category, amount_cents: v });
    }
    if (cents === null)
      problems.push(
        kind === "valuation"
          ? "Enter the change, e.g. -250.00 or 1200.00."
          : "Enter an amount such as 42.50.",
      );
    if (interestCents === null)
      problems.push("Interest must be an amount such as 18.20.");
    const finalCategory = newCategory.trim() || category;
    const tx: Transaction = {
      id: initial?.id ?? newId(),
      date,
      kind,
      amount_cents: cents ?? 0,
      account_id: accountId,
      to_account_id: kind === "transfer" ? toId || null : null,
      interest_cents: interestCents ?? 0,
      category:
        kind === "transfer" || kind === "valuation"
          ? "Transfer"
          : finalCategory,
      splits: kind === "transfer" || kind === "valuation" ? [] : parsedSplits,
      description: description.trim(),
      notes: notes.trim(),
      status: pending ? "pending" : "settled",
    };
    const all = [
      ...problems,
      ...(cents === null ? [] : validateTransaction(tx, state.accounts)),
    ];
    // The "before the opening date" notice is information, not an error.
    const blocking = all.filter((p) => !p.includes("opening balance date"));
    setErrors(all);
    if (blocking.length) return;
    if (newCategory.trim()) onAddCategory(newCategory.trim());
    onSave(tx);
  };

  return (
    <Card title={initial ? "Edit transaction" : "Add a transaction"}>
      <form className="money-form" onSubmit={submit} noValidate>
        <label className="money-form__wide">
          What happened
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TransactionKind)}
          >
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          {kind === "valuation"
            ? "Change in value (use − for a fall)"
            : "Amount"}
          <input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
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
              <option value="">Choose…</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {toDebt && (
          <label>
            Of which interest (optional)
            <input
              value={interest}
              inputMode="decimal"
              onChange={(e) => setInterest(e.target.value)}
              placeholder="From your statement"
            />
          </label>
        )}
        {kind !== "transfer" && kind !== "valuation" && splits.length === 0 && (
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {state.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "transfer" && kind !== "valuation" && splits.length === 0 && (
          <label>
            Or a new category
            <input
              value={newCategory}
              maxLength={60}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          </label>
        )}
        <label className="money-form__wide">
          Description
          <input
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {kind !== "transfer" && kind !== "valuation" && (
          <fieldset className="money-form__wide money-splits">
            <legend>Split across categories (optional)</legend>
            {splits.map((s, i) => (
              <div key={i} className="money-inline">
                <label>
                  Category
                  <select
                    value={s.category}
                    onChange={(e) =>
                      setSplits(
                        splits.map((x, j) =>
                          j === i ? { ...x, category: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {state.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    value={s.amount}
                    inputMode="decimal"
                    onChange={(e) =>
                      setSplits(
                        splits.map((x, j) =>
                          j === i ? { ...x, amount: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  small
                  variant="ghost"
                  onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              small
              variant="ghost"
              onClick={() =>
                setSplits([
                  ...splits,
                  { category: state.categories[0], amount: "" },
                ])
              }
            >
              Add a split
            </Button>
          </fieldset>
        )}
        <label className="money-form__wide">
          Notes (optional)
          <textarea
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="money-check">
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => setPending(e.target.checked)}
          />
          Pending (not yet cleared; left out of balances until marked settled)
        </label>
        {kind === "transfer" && (
          <p className="money-basis money-form__wide">
            A transfer moves your own money, so it is neither income nor
            spending. Paying a card or loan is a transfer to that debt; only the
            interest part counts as spending.
          </p>
        )}
        {errors.length > 0 && (
          <div className="money-form__wide">
            <Callout tone="error" role="alert">
              {errors.join(" ")}
            </Callout>
          </div>
        )}
        <div className="money-actions money-form__wide">
          <Button type="submit" variant="primary">
            Save transaction
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
