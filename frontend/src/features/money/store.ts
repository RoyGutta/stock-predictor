/**
 * Money Manager persistence: this browser's localStorage, nothing else.
 *
 * - Every read is validated field by field. A record that fails is dropped and
 *   counted, never cast; a blob that cannot be parsed at all is moved aside to a
 *   quarantine key (not deleted) so it can still be recovered.
 * - The stored document carries `schema_version`. Older versions are migrated
 *   step by step; a newer version than this build understands is left untouched
 *   and not loaded, rather than silently downgraded.
 * - Before a restore replaces the data, the current data is copied to a
 *   pre-restore key, so a bad restore can be undone.
 * - Nothing here touches the network.
 */

import { asFiniteNumber, isRecord } from "../../lib/storage";
import {
  ACCOUNT_TYPES,
  DEFAULT_CATEGORIES,
  EMPTY_STATE,
  MONEY_SCHEMA_VERSION,
  isIsoDate,
  type Account,
  type AccountType,
  type MoneyState,
  type Split,
  type Transaction,
  type TransactionKind,
} from "./model";

export const STORAGE_KEY = "stock-predictor:money";
export const QUARANTINE_KEY = "stock-predictor:money:quarantine";
export const PRE_RESTORE_KEY = "stock-predictor:money:pre-restore";

const KINDS: ReadonlySet<string> = new Set([
  "income",
  "expense",
  "refund",
  "transfer",
  "valuation",
]);
const MAX_TEXT = 500;

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function cents(value: unknown): number | null {
  const n = asFiniteNumber(value);
  return n !== null && Number.isSafeInteger(n) ? n : null;
}

/** null stays null; a valid non-negative integer passes; anything else is invalid (undefined). */
function nullableCents(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  const n = cents(value);
  return n === null || n < 0 ? undefined : n;
}

export function parseAccount(value: unknown): Account | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  const name = text(value.name, 120);
  const type = text(value.type, 32);
  const opening = cents(value.opening_balance_cents);
  const openingDate = text(value.opening_date, 10);
  const currency = text(value.currency, 3);
  if (!id || !name || !type || !(type in ACCOUNT_TYPES) || opening === null)
    return null;
  if (!openingDate || !isIsoDate(openingDate)) return null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const apr =
    value.apr === null || value.apr === undefined
      ? null
      : asFiniteNumber(value.apr);
  if (apr !== null && (apr < 0 || apr > 100)) return null;
  if (value.apr !== null && value.apr !== undefined && apr === null)
    return null;
  const minimum = nullableCents(value.minimum_payment_cents);
  const planned = nullableCents(value.planned_payment_cents);
  if (minimum === undefined || planned === undefined) return null;
  const dueDay =
    value.due_day === null || value.due_day === undefined
      ? null
      : asFiniteNumber(value.due_day);
  if (
    dueDay !== null &&
    (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
  )
    return null;
  return {
    id,
    name,
    type: type as AccountType,
    currency,
    institution: text(value.institution, 120) ?? "",
    notes: text(value.notes) ?? "",
    opening_balance_cents: opening,
    opening_date: openingDate,
    apr,
    minimum_payment_cents: minimum,
    planned_payment_cents: planned,
    due_day: dueDay,
    archived: value.archived === true,
  };
}

function parseSplit(value: unknown): Split | null {
  if (!isRecord(value)) return null;
  const category = text(value.category, 60);
  const amount = cents(value.amount_cents);
  return category && amount !== null && amount > 0
    ? { category, amount_cents: amount }
    : null;
}

export function parseTransaction(value: unknown): Transaction | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64);
  const date = text(value.date, 10);
  const kind = text(value.kind, 16);
  const amount = cents(value.amount_cents);
  const accountId = text(value.account_id, 64);
  if (!id || !date || !isIsoDate(date) || !kind || !KINDS.has(kind))
    return null;
  if (amount === null || !accountId) return null;
  if (kind === "valuation" ? amount === 0 : amount <= 0) return null;
  const interest =
    value.interest_cents === undefined ? 0 : cents(value.interest_cents);
  if (interest === null || interest < 0 || interest > Math.abs(amount))
    return null;
  const toAccount =
    value.to_account_id == null ? null : text(value.to_account_id, 64);
  if (kind === "transfer" && !toAccount) return null;
  const rawSplits = Array.isArray(value.splits) ? value.splits : [];
  const splits = rawSplits.map(parseSplit);
  if (splits.some((s) => s === null)) return null;
  return {
    id,
    date,
    kind: kind as TransactionKind,
    amount_cents: amount,
    account_id: accountId,
    to_account_id: kind === "transfer" ? toAccount : null,
    interest_cents: kind === "transfer" ? interest : 0,
    category: text(value.category, 60) || "Uncategorized",
    splits: splits as Split[],
    description: text(value.description) ?? "",
    notes: text(value.notes) ?? "",
    status: value.status === "pending" ? "pending" : "settled",
  };
}

export interface LoadResult {
  state: MoneyState;
  /** Records dropped because they failed validation. */
  dropped: number;
  /** The stored document could not be read at all and was moved to quarantine. */
  quarantined: boolean;
  /** The stored document was written by a newer build; left untouched, not loaded. */
  newer_version: number | null;
}

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
/** Keyed by the version they upgrade FROM. Version 1 is the first schema. */
export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(
  doc: Record<string, unknown>,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = MONEY_SCHEMA_VERSION,
): Record<string, unknown> | null {
  let version = asFiniteNumber(doc.schema_version);
  if (
    version === null ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > target
  ) {
    return null;
  }
  let current = doc;
  while (version < target) {
    const step = migrations[version];
    if (!step) return null;
    current = { ...step(current), schema_version: version + 1 };
    version += 1;
  }
  return current;
}

/** Validate a whole document (from storage or a backup). */
export function parseState(
  raw: unknown,
): { state: MoneyState; dropped: number } | null {
  if (!isRecord(raw)) return null;
  const doc = migrate(raw);
  if (!doc) return null;
  const rawAccounts = Array.isArray(doc.accounts) ? doc.accounts : null;
  const rawTransactions = Array.isArray(doc.transactions)
    ? doc.transactions
    : null;
  if (!rawAccounts || !rawTransactions) return null;
  const accounts = rawAccounts
    .map(parseAccount)
    .filter((a): a is Account => a !== null);
  const uniqueAccounts = [...new Map(accounts.map((a) => [a.id, a])).values()];
  const accountIds = new Set(uniqueAccounts.map((a) => a.id));
  const transactions = rawTransactions
    .map(parseTransaction)
    .filter(
      (t): t is Transaction =>
        t !== null &&
        accountIds.has(t.account_id) &&
        (t.to_account_id === null || accountIds.has(t.to_account_id)),
    );
  const uniqueTransactions = [
    ...new Map(transactions.map((t) => [t.id, t])).values(),
  ];
  const categories = Array.isArray(doc.categories)
    ? [
        ...new Set(
          doc.categories
            .map((c) => text(c, 60))
            .filter((c): c is string => !!c),
        ),
      ]
    : [...DEFAULT_CATEGORIES];
  const dropped =
    rawAccounts.length -
    uniqueAccounts.length +
    (rawTransactions.length - uniqueTransactions.length);
  return {
    state: {
      schema_version: MONEY_SCHEMA_VERSION,
      accounts: uniqueAccounts,
      transactions: uniqueTransactions,
      categories,
    },
    dropped,
  };
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function emptyResult(): LoadResult {
  return {
    state: structuredClone(EMPTY_STATE),
    dropped: 0,
    quarantined: false,
    newer_version: null,
  };
}

export function loadMoney(): LoadResult {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return emptyResult();
  }
  if (raw === null) return emptyResult();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(raw);
    return { ...emptyResult(), quarantined: true };
  }
  const version = isRecord(parsed)
    ? asFiniteNumber(parsed.schema_version)
    : null;
  if (version !== null && version > MONEY_SCHEMA_VERSION) {
    return { ...emptyResult(), newer_version: version };
  }
  const result = parseState(parsed);
  if (!result) {
    quarantine(raw);
    return { ...emptyResult(), quarantined: true };
  }
  return {
    state: result.state,
    dropped: result.dropped,
    quarantined: false,
    newer_version: null,
  };
}

function quarantine(raw: string): void {
  try {
    storage()?.setItem(QUARANTINE_KEY, raw);
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing more can be done */
  }
}

/** Returns false when the browser refused the write (quota, private mode, policy). */
export function saveMoney(state: MoneyState): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function snapshotBeforeRestore(): void {
  try {
    const store = storage();
    const current = store?.getItem(STORAGE_KEY);
    if (store && current) store.setItem(PRE_RESTORE_KEY, current);
  } catch {
    /* best effort */
  }
}

export function readPreRestore(): MoneyState | null {
  try {
    const raw = storage()?.getItem(PRE_RESTORE_KEY);
    return raw ? (parseState(JSON.parse(raw))?.state ?? null) : null;
  } catch {
    return null;
  }
}

export function hasQuarantine(): boolean {
  try {
    return storage()?.getItem(QUARANTINE_KEY) != null;
  } catch {
    return false;
  }
}

/** Remove every Money Manager key from this browser. */
export function clearMoney(): void {
  for (const key of [STORAGE_KEY, QUARANTINE_KEY, PRE_RESTORE_KEY]) {
    try {
      storage()?.removeItem(key);
    } catch {
      /* best effort */
    }
  }
}
