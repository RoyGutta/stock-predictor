/**
 * CSV export and import, entirely local.
 *
 * Export: every text cell that a spreadsheet would treat as a formula (starting
 * with = + - @, tab, or carriage return) is prefixed with an apostrophe, so an
 * imported description such as "=HYPERLINK(...)" cannot execute when the file
 * is opened in Excel or Sheets. Numbers are written as plain numbers.
 *
 * Import: an RFC 4180 parser (quoted fields, escaped quotes, CRLF), size and row
 * limits, explicit column mapping, a preview, and duplicate detection against
 * existing records and within the file. Nothing is imported without the user's
 * confirmation, and imported text is only ever rendered as text.
 */

import {
  isIsoDate,
  newId,
  parseMoney,
  type Account,
  type MoneyState,
  type Transaction,
} from "./model";

export const MAX_IMPORT_BYTES = 2_000_000;
export const MAX_IMPORT_ROWS = 5_000;

export function safeCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportTransactionsCsv(state: MoneyState): string {
  const names = new Map(state.accounts.map((a) => [a.id, a.name]));
  const header = [
    "date",
    "kind",
    "amount",
    "account",
    "to_account",
    "interest",
    "category",
    "description",
    "notes",
    "status",
  ];
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => [
      t.date,
      t.kind,
      t.amount_cents / 100,
      names.get(t.account_id) ?? "",
      t.to_account_id ? (names.get(t.to_account_id) ?? "") : "",
      t.interest_cents / 100,
      t.category,
      t.description,
      t.notes,
      t.status,
    ]);
  return (
    [header, ...rows].map((r) => r.map(safeCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export class CsvError extends Error {}

export function parseCsv(text: string): string[][] {
  if (text.length > MAX_IMPORT_BYTES)
    throw new CsvError("The file is larger than 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > MAX_IMPORT_ROWS + 1)
        throw new CsvError(`The file has more than ${MAX_IMPORT_ROWS} rows.`);
    } else field += ch;
  }
  if (quoted) throw new CsvError("The file has an unclosed quoted field.");
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface ColumnMap {
  date: number;
  description: number;
  amount: number;
  category: number | null;
}

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";

export function normalizeDate(
  value: string,
  format: DateFormat,
): string | null {
  const v = value.trim();
  let y: string, m: string, d: string;
  if (format === "YYYY-MM-DD") {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
    if (!match) return null;
    [, y, m, d] = match;
  } else {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!match) return null;
    [, m, d, y] = match;
    if (format === "DD/MM/YYYY") [m, d] = [d, m];
  }
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export interface PreviewRow {
  line: number;
  transaction: Transaction | null;
  error: string | null;
  duplicate: "existing" | "in_file" | null;
}

function fingerprint(
  t: Pick<
    Transaction,
    "account_id" | "date" | "amount_cents" | "kind" | "description"
  >,
): string {
  return [
    t.account_id,
    t.date,
    t.kind,
    t.amount_cents,
    t.description.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
}

/**
 * How the file signs amounts is the user's choice, not a guess: bank accounts
 * usually export money out as negative, card statements often export charges as
 * positive. The UI defaults this from the account type and shows it in the
 * preview. A transfer between the user's own accounts cannot be recognised
 * from one file; it imports as income or expense and is re-labelled afterwards.
 */
export type SignRule = "negative_is_outflow" | "positive_is_outflow";

export function defaultSignRule(account: Account): SignRule {
  return [
    "credit_card",
    "student_loan",
    "auto_loan",
    "mortgage",
    "personal_loan",
    "other_liability",
  ].includes(account.type)
    ? "positive_is_outflow"
    : "negative_is_outflow";
}

export function previewImport(
  rows: string[][],
  map: ColumnMap,
  account: Account,
  dateFormat: DateFormat,
  signRule: SignRule,
  existing: Transaction[],
  hasHeader = true,
): PreviewRow[] {
  const seen = new Set(existing.map(fingerprint));
  const inFile = new Set<string>();
  return rows.slice(hasHeader ? 1 : 0).map((cells, index) => {
    const line = index + (hasHeader ? 2 : 1);
    const date = normalizeDate(cells[map.date] ?? "", dateFormat);
    const amount = parseMoney((cells[map.amount] ?? "").replace(/\s/g, ""), {
      allowNegative: true,
    });
    const description = (cells[map.description] ?? "").trim().slice(0, 500);
    if (!date)
      return {
        line,
        transaction: null,
        error: "Date is missing or not in the chosen format.",
        duplicate: null,
      };
    if (amount === null || amount === 0)
      return {
        line,
        transaction: null,
        error: "Amount is missing or not a number.",
        duplicate: null,
      };
    const outflow =
      signRule === "negative_is_outflow" ? amount < 0 : amount > 0;
    const tx: Transaction = {
      id: newId(),
      date,
      kind: outflow ? "expense" : "income",
      amount_cents: Math.abs(amount),
      account_id: account.id,
      to_account_id: null,
      interest_cents: 0,
      category:
        (map.category !== null
          ? (cells[map.category] ?? "").trim().slice(0, 60)
          : "") || "Uncategorized",
      splits: [],
      description,
      notes: "Imported from CSV",
      status: "settled",
    };
    const key = fingerprint(tx);
    const duplicate = seen.has(key)
      ? "existing"
      : inFile.has(key)
        ? "in_file"
        : null;
    inFile.add(key);
    return { line, transaction: tx, error: null, duplicate };
  });
}
