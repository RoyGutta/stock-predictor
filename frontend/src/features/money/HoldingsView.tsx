import { useState } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { HoldingForm } from "./HoldingForm";
import { AllocationCard, ConcentrationCard, MixCard } from "./HoldingsAnalysis";
import { ProfileCard } from "./HoldingsProfile";
import {
  concentration,
  holdingAccounts,
  portfolio,
  reconcileAccounts,
  STALE_PRICE_DAYS,
  type HoldingRow,
} from "./holdings";
import { formatCents, todayIso, type Account, type MoneyState } from "./model";
import type { Holding, PlanningState } from "./planning";
import "./holdings.css";

export const PRICE_STATEMENT =
  "Values use the prices you entered on the dates shown. This app does not look up prices for your holdings.";

/**
 * Investment holdings, valued only with the prices the user entered. The rest
 * of the site uses synthetic market data; none of it reaches this view.
 */
export function HoldingsView({
  state,
  onPlanning,
}: {
  state: MoneyState;
  onPlanning: (fn: (p: PlanningState) => PlanningState) => void;
}) {
  const [editing, setEditing] = useState<Holding | "new" | null>(null);
  const today = todayIso();
  const p = portfolio(state, today);
  const checks = reconcileAccounts(state, p.rows, today);
  const conc = concentration(p, state.planning.profile);
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const canAdd = holdingAccounts(state.accounts, null).length > 0;

  const save = (h: Holding) => {
    onPlanning((pl) => {
      const exists = pl.holdings.some((x) => x.id === h.id);
      return {
        ...pl,
        holdings: exists
          ? pl.holdings.map((x) => (x.id === h.id ? h : x))
          : [...pl.holdings, h],
      };
    });
    setEditing(null);
  };
  const remove = (id: string) =>
    onPlanning((pl) => ({
      ...pl,
      holdings: pl.holdings.filter((x) => x.id !== id),
    }));

  return (
    <>
      <Callout tone="note">
        <strong>{PRICE_STATEMENT}</strong> Prices shown elsewhere on this site
        are synthetic and are never used here.
      </Callout>
      {editing !== null && (
        <HoldingForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          accounts={state.accounts}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      <Card
        title="Holdings"
        action={
          editing === null && canAdd ? (
            <Button small onClick={() => setEditing("new")}>
              Add holding
            </Button>
          ) : undefined
        }
      >
        {!canAdd && (
          <p className="money-basis">
            Holdings belong to a brokerage, retirement, or other asset account.
            Add one of those in Accounts first.
          </p>
        )}
        {p.rows.length === 0 ? (
          canAdd && <p className="money-basis">No holdings yet.</p>
        ) : (
          <HoldingsTable
            rows={p.rows}
            accounts={accounts}
            onEdit={setEditing}
            onDelete={remove}
          />
        )}
        <p className="money-basis">
          Value is quantity times the price you entered, rounded to the cent.
          Gain is value minus your total cost basis, before taxes and fees. A
          price more than {STALE_PRICE_DAYS} days old is marked out of date.
        </p>
      </Card>
      {checks.length > 0 && (
        <Card title="Holdings against account balances">
          <ul className="money-list">
            {checks.map((c) => (
              <li key={c.account_id} className="money-item">
                <span className="money-item__name">{c.account_name}</span>
                <span className="money-basis">
                  Account balance{" "}
                  {formatCents(c.ledger_balance_cents, c.currency)}; valued
                  holdings {formatCents(c.valued_holdings_cents, c.currency)} (
                  {c.valued_count} with a price
                  {c.unvalued_count > 0 &&
                    `, ${c.unvalued_count} without`}).{" "}
                  {c.difference_cents === 0
                    ? "They match."
                    : `Difference ${formatCents(c.difference_cents, c.currency)}: unallocated (cash, unpriced holdings) or out of date. The two are not forced to match.`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {p.rows.length > 0 && (
        <>
          <AllocationCard p={p} />
          <ConcentrationCard c={conc} />
          <MixCard p={p} />
        </>
      )}
      <ProfileCard
        profile={state.planning.profile}
        onSave={(profile) => onPlanning((pl) => ({ ...pl, profile }))}
      />
    </>
  );
}

function HoldingsTable({
  rows,
  accounts,
  onEdit,
  onDelete,
}: {
  rows: HoldingRow[];
  accounts: Map<string, Account>;
  onEdit: (h: Holding) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="money-table-scroll">
      <table className="money-table holdings-table">
        <caption>Your holdings</caption>
        <thead>
          <tr>
            <th scope="col">Holding</th>
            <th scope="col">Account</th>
            <th scope="col">Quantity</th>
            <th scope="col">Price (date)</th>
            <th scope="col">Value</th>
            <th scope="col">Gain</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const h = r.holding;
            const account = accounts.get(h.account_id);
            const currency = account?.currency ?? "USD";
            const label = h.symbol || h.name;
            return (
              <tr key={h.id}>
                <th scope="row">
                  {label}
                  {h.symbol && h.name && (
                    <span className="money-sub">{h.name}</span>
                  )}
                </th>
                <td>{account?.name ?? "Missing account"}</td>
                <td>
                  {h.quantity.toLocaleString("en-US", {
                    maximumFractionDigits: 8,
                  })}
                </td>
                <td>
                  {h.price_cents != null && h.price_date ? (
                    <>
                      {formatCents(h.price_cents, currency)}
                      <span className="money-sub">
                        {h.price_date}
                        {r.stale
                          ? ` ⚠ out of date (${r.price_age_days} days)`
                          : ` (${r.price_age_days} days ago)`}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  {r.value_cents != null
                    ? formatCents(r.value_cents, currency)
                    : `— ${r.value_missing}`}
                </td>
                <td>
                  {r.gain_cents != null ? (
                    formatCents(r.gain_cents, currency)
                  ) : (
                    <span className="money-sub">{r.gain_missing}</span>
                  )}
                </td>
                <td>
                  <div className="money-actions holdings-row-actions">
                    {confirming === h.id ? (
                      <>
                        <span className="money-warn">Delete {label}?</span>
                        <Button small onClick={() => onDelete(h.id)}>
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
                      <>
                        <Button
                          small
                          variant="ghost"
                          aria-label={`Edit ${label}`}
                          onClick={() => onEdit(h)}
                        >
                          Edit
                        </Button>
                        <Button
                          small
                          variant="ghost"
                          aria-label={`Delete ${label}`}
                          onClick={() => setConfirming(h.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
