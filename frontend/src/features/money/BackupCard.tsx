import { useState } from "react";

import { Button, Callout, Card } from "../../components/ui";
import {
  BackupError,
  createBackup,
  openBackup,
  passphraseProblem,
} from "./backup";
import { download, readFile, type DataProps as Props } from "./dataShared";
import { todayIso, type MoneyState } from "./model";

export function BackupCard({ state, onRestore, onUndoRestore }: Props) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{
    tone: "note" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const [restorePass, setRestorePass] = useState("");
  const [candidate, setCandidate] = useState<{
    state: MoneyState;
    dropped: number;
    created_at: string;
  } | null>(null);

  const makeBackup = async () => {
    const problem =
      passphraseProblem(pass) ??
      (pass !== confirm ? "The two passphrases do not match." : null);
    if (problem) return setStatus({ tone: "error", text: problem });
    setBusy(true);
    try {
      const file = await createBackup(state, pass);
      download(`money-backup-${todayIso()}.json`, file, "application/json");
      setStatus({
        tone: "note",
        text: "Encrypted backup downloaded. Keep the passphrase somewhere safe: without it the backup cannot be opened.",
      });
      setPass("");
      setConfirm("");
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof BackupError
            ? error.message
            : "The backup could not be created.",
      });
    } finally {
      setBusy(false);
    }
  };

  const decrypt = async () => {
    if (!restoreText) return;
    setBusy(true);
    setCandidate(null);
    try {
      setCandidate(await openBackup(restoreText, restorePass));
      setStatus(null);
    } catch (error) {
      setStatus({
        tone: "error",
        text:
          error instanceof BackupError
            ? error.message
            : "The backup could not be opened.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Encrypted backup">
      <div className="money-form">
        <label>
          Passphrase
          <input
            type="password"
            autoComplete="new-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label>
          Repeat passphrase
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="money-basis money-form__wide">
          The file is encrypted in this browser with AES-256-GCM, using a key
          derived from your passphrase (PBKDF2-SHA-256, 600,000 rounds). The
          passphrase is never stored or sent.
        </p>
        <div className="money-actions money-form__wide">
          <Button variant="primary" onClick={makeBackup} disabled={busy}>
            Download encrypted backup
          </Button>
        </div>
      </div>

      <h3 className="money-subtitle">Restore from a backup</h3>
      <div className="money-form">
        <label>
          Backup file
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              setCandidate(null);
              try {
                setRestoreText(await readFile(e, 20_000_000));
              } catch (error) {
                setStatus({ tone: "error", text: (error as Error).message });
              }
            }}
          />
        </label>
        <label>
          Its passphrase
          <input
            type="password"
            autoComplete="current-password"
            value={restorePass}
            onChange={(e) => setRestorePass(e.target.value)}
          />
        </label>
        <div className="money-actions money-form__wide">
          <Button onClick={decrypt} disabled={busy || !restoreText}>
            Open backup
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setStatus(
                onUndoRestore()
                  ? {
                      tone: "note",
                      text: "The data from before the last restore is back.",
                    }
                  : {
                      tone: "error",
                      text: "There is no earlier data to go back to.",
                    },
              )
            }
          >
            Undo last restore
          </Button>
        </div>
      </div>
      {candidate && (
        <Callout tone="note">
          This backup
          {candidate.created_at
            ? ` from ${candidate.created_at.slice(0, 10)}`
            : ""}{" "}
          holds {candidate.state.accounts.length} accounts and{" "}
          {candidate.state.transactions.length} transactions
          {candidate.dropped
            ? `; ${candidate.dropped} invalid record(s) will be skipped`
            : ""}
          . Restoring replaces everything currently here (
          {state.accounts.length} accounts, {state.transactions.length}{" "}
          transactions); the current data is kept for one undo.{" "}
          <Button
            small
            variant="primary"
            onClick={() => {
              onRestore(candidate.state);
              setCandidate(null);
              setStatus({ tone: "note", text: "Backup restored." });
            }}
          >
            Replace with this backup
          </Button>
        </Callout>
      )}
      {status && (
        <div role={status.tone === "error" ? "alert" : "status"}>
          <Callout tone={status.tone}>{status.text}</Callout>
        </div>
      )}
    </Card>
  );
}
