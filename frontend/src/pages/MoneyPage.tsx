import { useState } from "react";

import { Callout, Card } from "../components/ui";
import { AccountsView } from "../features/money/AccountsView";
import { DataView } from "../features/money/DataView";
import { MoneyOverview } from "../features/money/MoneyOverview";
import { TransactionsView } from "../features/money/TransactionsView";
import { useMoney } from "../features/money/useMoney";
import "../features/money/money.css";

type Section = "overview" | "accounts" | "transactions" | "data";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "accounts", label: "Accounts" },
  { key: "transactions", label: "Transactions" },
  { key: "data", label: "Backup & data" },
];

/**
 * Money Manager: the user's own accounts, debts, and transactions, kept in this
 * browser only. Separate from the market-research pages and their data.
 */
export function MoneyPage() {
  const money = useMoney();
  const [section, setSection] = useState<Section>("overview");
  const [openAccountForm, setOpenAccountForm] = useState(false);
  const { load } = money;

  return (
    <div className="page money-page">
      <Card>
        <div className="welcome">
          <h1 className="welcome__title">Money Manager</h1>
          <p className="welcome__body">
            Track what you have, what you owe, and where your money goes. Your
            records stay in this browser on this device; nothing you enter here
            is sent to a server. It works from your own entries only: it does
            not connect to banks or look up prices.
          </p>
        </div>
        <div
          className="ranges money-tabs"
          role="group"
          aria-label="Money Manager sections"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className="ranges__option"
              aria-pressed={section === s.key}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Card>

      {load.quarantined && (
        <Callout tone="error" role="alert">
          Your saved Money Manager data could not be read, so it was set aside
          rather than deleted, and an empty workspace was opened. Restore an
          encrypted backup from the Backup &amp; data tab if you have one.
        </Callout>
      )}
      {load.newer_version !== null && (
        <Callout tone="error" role="alert">
          Your data was saved by a newer version of this app (format{" "}
          {load.newer_version}). It was left untouched and not opened, so
          nothing is lost; reload the latest version of the site. Changes made
          here now will not be saved over it.
        </Callout>
      )}
      {load.dropped > 0 && (
        <Callout tone="note">
          {load.dropped} saved record{load.dropped === 1 ? " was" : "s were"}{" "}
          invalid and skipped when your data was loaded.
        </Callout>
      )}
      {!money.saved && (
        <Callout tone="error" role="alert">
          This browser refused to save your latest change (storage full, private
          browsing, or blocked site data). Your entries are on screen but will
          be lost on reload: download an encrypted backup now.
        </Callout>
      )}

      {section === "overview" && (
        <MoneyOverview
          state={money.state}
          onStart={() => {
            setOpenAccountForm(true);
            setSection("accounts");
          }}
        />
      )}
      {section === "accounts" && (
        <AccountsView
          state={money.state}
          onSave={money.upsertAccount}
          onDelete={money.deleteAccount}
          startOpen={openAccountForm}
        />
      )}
      {section === "transactions" && (
        <TransactionsView
          state={money.state}
          onSave={money.upsertTransaction}
          onDelete={money.deleteTransaction}
          onAddCategory={money.addCategory}
        />
      )}
      {section === "data" && (
        <DataView
          state={money.state}
          onRestore={money.replaceAll}
          onUndoRestore={money.undoRestore}
          onImport={money.addTransactions}
          onClearAll={money.clearAll}
        />
      )}
    </div>
  );
}
