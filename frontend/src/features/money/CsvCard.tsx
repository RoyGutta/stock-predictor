import { useState, type ChangeEvent } from "react";

import { Button, Callout, Card } from "../../components/ui";
import { downloadCsv } from "../../lib/export";
import {
  CsvError,
  defaultSignRule,
  exportTransactionsCsv,
  parseCsv,
  previewImport,
  type DateFormat,
  type PreviewRow,
  type SignRule,
} from "./csv";
import { readFile, type DataProps as Props } from "./dataShared";
import { formatCents, todayIso, type Transaction } from "./model";

export function CsvCard({ state, onImport }: Props) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(state.accounts[0]?.id ?? "");
  const [dateFormat, setDateFormat] = useState<DateFormat>("YYYY-MM-DD");
  const account = state.accounts.find((a) => a.id === accountId);
  const [signRule, setSignRule] = useState<SignRule>(
    account ? defaultSignRule(account) : "negative_is_outflow",
  );
  const [map, setMap] = useState({
    date: 0,
    description: 1,
    amount: 2,
    category: -1,
  });
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const header = rows?.[0] ?? [];
  const preview: PreviewRow[] =
    rows && account
      ? previewImport(
          rows,
          { ...map, category: map.category < 0 ? null : map.category },
          account,
          dateFormat,
          signRule,
          state.transactions,
        )
      : [];
  const importable = preview.filter(
    (p) => p.transaction && (includeDuplicates || !p.duplicate),
  );

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setDone(null);
    try {
      const parsed = parseCsv(await readFile(e, 2_000_000));
      if (parsed.length < 2)
        throw new CsvError(
          "The file needs a header row and at least one transaction.",
        );
      const lower = parsed[0].map((h) => h.trim().toLowerCase());
      const find = (...names: string[]) =>
        lower.findIndex((h) => names.some((n) => h.includes(n)));
      setMap({
        date: Math.max(find("date"), 0),
        description: Math.max(
          find("description", "payee", "merchant", "memo", "name"),
          0,
        ),
        amount: Math.max(find("amount", "value"), 0),
        category: find("category"),
      });
      setRows(parsed);
    } catch (err) {
      setRows(null);
      setError((err as Error).message);
    }
  };

  const column = (
    key: "date" | "description" | "amount" | "category",
    label: string,
    optional = false,
  ) => (
    <label>
      {label}
      <select
        value={map[key]}
        onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}
      >
        {optional && <option value={-1}>None</option>}
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card title="CSV export and import">
      <div className="money-actions">
        <Button
          onClick={() =>
            downloadCsv(
              `transactions-${todayIso()}.csv`,
              exportTransactionsCsv(state),
            )
          }
          disabled={state.transactions.length === 0}
        >
          Export transactions as CSV
        </Button>
      </div>
      <p className="money-basis">
        The CSV is not encrypted. Text that a spreadsheet would treat as a
        formula is prefixed with an apostrophe so it cannot run.
      </p>

      <h3 className="money-subtitle">Import a bank export</h3>
      {state.accounts.length === 0 ? (
        <p className="money-basis">
          Add the account the file belongs to first.
        </p>
      ) : (
        <div className="money-form">
          <label>
            CSV file (up to 2 MB)
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
          </label>
          <label>
            Into account
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                const next = state.accounts.find(
                  (a) => a.id === e.target.value,
                );
                if (next) setSignRule(defaultSignRule(next));
              }}
            >
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date format in the file
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as DateFormat)}
            >
              <option value="YYYY-MM-DD">2026-03-05</option>
              <option value="MM/DD/YYYY">03/05/2026 (month first)</option>
              <option value="DD/MM/YYYY">05/03/2026 (day first)</option>
            </select>
          </label>
          <label>
            Amount signs in the file
            <select
              value={signRule}
              onChange={(e) => setSignRule(e.target.value as SignRule)}
            >
              <option value="negative_is_outflow">
                Negative = money out (typical for bank accounts)
              </option>
              <option value="positive_is_outflow">
                Positive = charge (typical for card statements)
              </option>
            </select>
          </label>
          {rows && (
            <>
              {column("date", "Date column")}
              {column("description", "Description column")}
              {column("amount", "Amount column")}
              {column("category", "Category column", true)}
            </>
          )}
        </div>
      )}
      {error && (
        <div role="alert">
          <Callout tone="error">{error}</Callout>
        </div>
      )}
      {rows && account && (
        <>
          <p className="money-basis" role="status">
            {preview.length} rows: {preview.filter((p) => p.error).length} with
            errors (skipped), {preview.filter((p) => p.duplicate).length}{" "}
            possible duplicates. Rows import as income or expenses; mark any
            that were transfers between your own accounts afterwards.
          </p>
          <div className="money-table-scroll">
            <table className="money-table">
              <caption className="visually-hidden">
                Import preview, first 50 rows
              </caption>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((p) => (
                  <tr key={p.line}>
                    <th scope="row">{p.line}</th>
                    <td>{p.transaction?.date ?? "—"}</td>
                    <td>{p.transaction?.description ?? ""}</td>
                    <td>
                      {p.transaction
                        ? `${p.transaction.kind === "expense" ? "−" : "+"}${formatCents(p.transaction.amount_cents, account.currency)}`
                        : "—"}
                    </td>
                    <td>
                      {p.error ??
                        (p.duplicate === "existing"
                          ? "Already recorded?"
                          : p.duplicate === "in_file"
                            ? "Repeated in file?"
                            : p.transaction?.kind)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="money-check">
            <input
              type="checkbox"
              checked={includeDuplicates}
              onChange={(e) => setIncludeDuplicates(e.target.checked)}
            />
            Also import rows that look like duplicates
          </label>
          <div className="money-actions">
            <Button
              variant="primary"
              disabled={importable.length === 0}
              onClick={() => {
                onImport(importable.map((p) => p.transaction as Transaction));
                setDone(
                  `Imported ${importable.length} transactions into ${account.name}.`,
                );
                setRows(null);
              }}
            >
              Import {importable.length} transactions
            </Button>
          </div>
        </>
      )}
      {done && (
        <div role="status">
          <Callout tone="note">{done}</Callout>
        </div>
      )}
    </Card>
  );
}
