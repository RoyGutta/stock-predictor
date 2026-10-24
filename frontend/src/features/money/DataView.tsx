import { useState } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { BackupCard } from "./BackupCard";
import { CsvCard } from "./CsvCard";
import type { DataProps as Props } from "./dataShared";

export function DataView(props: Props) {
  return (
    <>
      <Card title="Where your data lives">
        <p className="money-basis">
          Everything in the Money Manager is stored only in this browser
          profile, on this device. It is never sent to this site&rsquo;s server
          or to anyone else, and no account or bank login is involved. Clearing
          this site&rsquo;s data, using a private window, or switching browser
          or device means the records are not there. An encrypted backup is the
          only way to keep a copy or move it.
        </p>
      </Card>
      <BackupCard {...props} />
      <CsvCard {...props} />
      <DeleteCard {...props} />
    </>
  );
}

function DeleteCard({ state, onClearAll }: Props) {
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);
  return (
    <Card title="Delete everything">
      <p className="money-basis">
        Removes every account, transaction, and category from this browser,
        including the undo copy. It cannot be reversed. Download an encrypted
        backup first if you may want the records again. Currently stored:{" "}
        {state.accounts.length} accounts, {state.transactions.length}{" "}
        transactions.
      </p>
      <div className="money-form">
        <label>
          Type DELETE to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="money-actions money-form__wide">
          <Button
            disabled={typed !== "DELETE"}
            onClick={() => {
              onClearAll();
              setTyped("");
              setDone(true);
            }}
          >
            Delete all Money Manager data
          </Button>
        </div>
      </div>
      {done && (
        <div role="status">
          <Callout tone="note">
            All Money Manager data was removed from this browser.
          </Callout>
        </div>
      )}
    </Card>
  );
}
