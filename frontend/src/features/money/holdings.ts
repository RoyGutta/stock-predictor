/**
 * Investment holdings: value, gain, price age, per-account reconciliation,
 * allocation, concentration, and comparison with a reference mix.
 *
 * Rules, pinned by holdings.test.ts:
 * - A holding is valued ONLY with the price the user entered and the date it
 *   applies to. No price or no date = value null ("needs a price"). The app's
 *   market prices are synthetic and are never used for a user's holdings.
 * - Integer cents throughout; quantity x price is rounded to the cent.
 * - Allocation and concentration use valued holdings only, and say how many
 *   holdings were left out because they have no dated price.
 * - Only U.S.-dollar accounts are aggregated (as in model.ts); holdings in other
 *   currencies are listed, never converted.
 * - Descriptive only: no projections, no recommendations.
 */

import { balances } from "./ledger";
import type { Account, MoneyState } from "./model";
import {
  ASSET_CLASS_LABELS,
  type AssetClass,
  type Holding,
  type Profile,
} from "./planning";

/** A price older than this many days (as of today) is flagged as out of date. */
export const STALE_PRICE_DAYS = 31;
/** One position above this share of valued holdings is flagged for review. */
export const SINGLE_HOLDING_LIMIT_PCT = 20;
/** One sector above this share of valued holdings is flagged for review. */
export const SECTOR_LIMIT_PCT = 35;

/** Account types that can hold investments in this app. */
export const HOLDING_ACCOUNT_TYPES = [
  "brokerage",
  "retirement",
  "other_asset",
] as const;

export function canHoldInvestments(account: Pick<Account, "type">): boolean {
  return (HOLDING_ACCOUNT_TYPES as readonly string[]).includes(account.type);
}

/** Accounts a holding can be placed in; keeps the current one when editing. */
export function holdingAccounts(
  accounts: Account[],
  currentId: string | null,
): Account[] {
  return accounts.filter(
    (a) => (canHoldInvestments(a) && !a.archived) || a.id === currentId,
  );
}

// --- one holding -------------------------------------------------------------

export interface HoldingRow {
  holding: Holding;
  /** quantity x entered price, rounded to the cent. Null = needs a price. */
  value_cents: number | null;
  value_missing: string | null;
  /** value - cost basis. Null when either is unknown. */
  gain_cents: number | null;
  gain_missing: string | null;
  /** Days from the price date to asOf. Null when there is no dated price. */
  price_age_days: number | null;
  /** Price is older than STALE_PRICE_DAYS. */
  stale: boolean;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), in UTC so DST cannot skew it. */
export function daysBetween(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function valueHolding(holding: Holding, asOf: string): HoldingRow {
  const { price_cents, price_date, quantity, cost_basis_cents } = holding;
  let value_cents: number | null = null;
  let value_missing: string | null = null;
  if (price_cents == null) value_missing = "Needs a price";
  else if (!price_date) value_missing = "Needs the date of the price";
  else if (!Number.isFinite(quantity))
    value_missing = "Quantity is not a number";
  else value_cents = Math.round(quantity * price_cents) || 0; // || 0 drops -0

  let gain_cents: number | null = null;
  let gain_missing: string | null = null;
  if (value_cents == null) gain_missing = "No value yet";
  else if (cost_basis_cents == null) gain_missing = "Cost basis not entered";
  else gain_cents = value_cents - cost_basis_cents;

  const price_age_days =
    value_cents != null && price_date ? daysBetween(price_date, asOf) : null;
  return {
    holding,
    value_cents,
    value_missing,
    gain_cents,
    gain_missing,
    price_age_days,
    stale: price_age_days != null && price_age_days > STALE_PRICE_DAYS,
  };
}

// --- accounts -----------------------------------------------------------------

export interface AccountCheck {
  account_id: string;
  account_name: string;
  currency: string;
  /** Balance from the ledger (opening balance plus settled transactions). */
  ledger_balance_cents: number;
  /** Sum of holdings that have a dated price. */
  valued_holdings_cents: number;
  valued_count: number;
  unvalued_count: number;
  /**
   * ledger - valued holdings. Positive: part of the balance is not described by
   * a valued holding (cash, unpriced holdings, or out-of-date figures). Never
   * forced to zero.
   */
  difference_cents: number;
}

/** One row per account that has at least one holding. */
export function reconcileAccounts(
  state: MoneyState,
  rows: HoldingRow[],
  asOf: string,
): AccountCheck[] {
  const ledger = balances(state, asOf);
  const out: AccountCheck[] = [];
  for (const account of state.accounts) {
    const mine = rows.filter((r) => r.holding.account_id === account.id);
    if (mine.length === 0) continue;
    const valued = mine.filter((r) => r.value_cents != null);
    const total = valued.reduce((s, r) => s + (r.value_cents as number), 0);
    const ledgerBalance = ledger.get(account.id) ?? 0;
    out.push({
      account_id: account.id,
      account_name: account.name,
      currency: account.currency,
      ledger_balance_cents: ledgerBalance,
      valued_holdings_cents: total,
      valued_count: valued.length,
      unvalued_count: mine.length - valued.length,
      difference_cents: ledgerBalance - total,
    });
  }
  return out;
}

// --- portfolio: allocation and concentration -----------------------------------

export interface Slice {
  key: string;
  label: string;
  value_cents: number;
  /** Percent of valued, aggregated holdings, 0-100. */
  pct: number;
}

export interface Portfolio {
  rows: HoldingRow[];
  /** U.S.-dollar holdings that have a dated price. */
  total_valued_cents: number;
  valued_count: number;
  /** U.S.-dollar holdings without a dated price: their value is unknown. */
  unvalued_count: number;
  /** Unvalued holdings as a percent of all aggregated holdings, by count. */
  unvalued_pct_of_count: number | null;
  /** Known cost basis of the unvalued holdings, for scale only (not a value). */
  unvalued_cost_basis_cents: number;
  /** Holdings left out of totals: account missing or not in U.S. dollars. */
  excluded: { holding: Holding; reason: string }[];
  by_class: Slice[];
  by_sector: Slice[];
}

export const UNSPECIFIED_SECTOR = "Unspecified";

function sectorOf(h: Holding): string {
  return h.sector.trim() || UNSPECIFIED_SECTOR;
}

/** Sectors group case-insensitively ("Energy" and "energy " are one sector). */
function sectorKey(h: Holding): string {
  return sectorOf(h).toLowerCase();
}

function slices(
  rows: HoldingRow[],
  keyOf: (h: Holding) => string,
  labelOf: (key: string) => string,
  total: number,
): Slice[] {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r.holding);
    sums.set(k, (sums.get(k) ?? 0) + (r.value_cents as number));
  }
  return [...sums.entries()]
    .map(([key, value_cents]) => ({
      key,
      label: labelOf(key),
      value_cents,
      pct: total > 0 ? (value_cents / total) * 100 : 0,
    }))
    .sort(
      (a, b) => b.value_cents - a.value_cents || a.key.localeCompare(b.key),
    );
}

export function portfolio(state: MoneyState, asOf: string): Portfolio {
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const rows = state.planning.holdings.map((h) => valueHolding(h, asOf));
  const excluded: Portfolio["excluded"] = [];
  const included: HoldingRow[] = [];
  for (const r of rows) {
    const account = accounts.get(r.holding.account_id);
    if (!account)
      excluded.push({
        holding: r.holding,
        reason: "Its account no longer exists",
      });
    else if (account.currency !== "USD")
      excluded.push({
        holding: r.holding,
        reason: `Held in ${account.currency}; currencies are not converted`,
      });
    else included.push(r);
  }
  const valued = included.filter((r) => r.value_cents != null);
  const unvalued = included.filter((r) => r.value_cents == null);
  const total = valued.reduce((s, r) => s + (r.value_cents as number), 0);
  const sectorLabels = new Map<string, string>();
  for (const r of valued)
    if (!sectorLabels.has(sectorKey(r.holding)))
      sectorLabels.set(sectorKey(r.holding), sectorOf(r.holding));
  return {
    rows,
    total_valued_cents: total,
    valued_count: valued.length,
    unvalued_count: unvalued.length,
    unvalued_pct_of_count:
      included.length > 0 ? (unvalued.length / included.length) * 100 : null,
    unvalued_cost_basis_cents: unvalued.reduce(
      (s, r) => s + (r.holding.cost_basis_cents ?? 0),
      0,
    ),
    excluded,
    by_class: slices(
      valued,
      (h) => h.asset_class,
      (k) => ASSET_CLASS_LABELS[k as AssetClass] ?? k,
      total,
    ),
    by_sector: slices(
      valued,
      sectorKey,
      (k) => sectorLabels.get(k) ?? k,
      total,
    ),
  };
}

export interface Concentration {
  /** Same symbol across accounts counts as one position. */
  largest: { label: string; value_cents: number; pct: number } | null;
  top3_pct: number | null;
  largest_sector: { label: string; value_cents: number; pct: number } | null;
  single_flag: boolean;
  sector_flag: boolean;
  /** Plain statements with the numbers, for display. */
  findings: string[];
  /** Holdings (valued or not) in a sector the profile lists as excluded. */
  in_excluded_sectors: Holding[];
}

const pct1 = (n: number) => `${n.toFixed(1)}%`;

export function concentration(p: Portfolio, profile: Profile): Concentration {
  const valued = p.rows.filter(
    (r) =>
      r.value_cents != null && !p.excluded.some((e) => e.holding === r.holding),
  );
  const positions = slices(
    valued,
    (h) => (h.symbol.trim() || h.name.trim() || h.id).toUpperCase(),
    (k) => k,
    p.total_valued_cents,
  );
  const total = p.total_valued_cents;
  // Integer comparisons so the threshold itself is exact: share > limit.
  const over = (value: number, limitPct: number) =>
    total > 0 && value * 100 > total * limitPct;
  const largest = positions[0] ?? null;
  const sector = p.by_sector[0] ?? null;
  const top3 = positions.slice(0, 3).reduce((s, x) => s + x.value_cents, 0);
  const single_flag =
    largest != null && over(largest.value_cents, SINGLE_HOLDING_LIMIT_PCT);
  const sector_flag =
    sector != null && over(sector.value_cents, SECTOR_LIMIT_PCT);

  const findings: string[] = [];
  if (largest && single_flag)
    findings.push(
      `${largest.label} is ${pct1(largest.pct)} of your valued holdings, above the ${SINGLE_HOLDING_LIMIT_PCT}% level this page uses to mark a concentration to review.`,
    );
  if (sector && sector_flag)
    findings.push(
      `The ${sector.label} sector is ${pct1(sector.pct)} of your valued holdings, above the ${SECTOR_LIMIT_PCT}% level this page uses to mark a concentration to review.`,
    );

  const excludedSet = new Set(
    profile.excluded_sectors.map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  const in_excluded_sectors = p.rows
    .map((r) => r.holding)
    .filter((h) => excludedSet.has(h.sector.trim().toLowerCase()));
  for (const h of in_excluded_sectors)
    findings.push(
      `${h.symbol || h.name} is in ${h.sector.trim()}, a sector your profile lists as one you want to avoid.`,
    );

  return {
    largest: largest
      ? {
          label: largest.label,
          value_cents: largest.value_cents,
          pct: largest.pct,
        }
      : null,
    top3_pct: positions.length > 0 && total > 0 ? (top3 / total) * 100 : null,
    largest_sector: sector
      ? {
          label: sector.label,
          value_cents: sector.value_cents,
          pct: sector.pct,
        }
      : null,
    single_flag,
    sector_flag,
    findings,
    in_excluded_sectors,
  };
}

// --- reference mixes -------------------------------------------------------------

/**
 * Buckets for comparison. U.S. and international stocks are combined as
 * "Stocks" because the presets are stated that way.
 */
export type MixBucket =
  | "stocks"
  | "bond"
  | "cash_equivalent"
  | "real_estate"
  | "commodity"
  | "crypto"
  | "other";

export const MIX_BUCKETS: MixBucket[] = [
  "stocks",
  "bond",
  "cash_equivalent",
  "real_estate",
  "commodity",
  "crypto",
  "other",
];

export const MIX_BUCKET_LABELS: Record<MixBucket, string> = {
  stocks: "Stocks (U.S. and international)",
  bond: ASSET_CLASS_LABELS.bond,
  cash_equivalent: ASSET_CLASS_LABELS.cash_equivalent,
  real_estate: ASSET_CLASS_LABELS.real_estate,
  commodity: ASSET_CLASS_LABELS.commodity,
  crypto: ASSET_CLASS_LABELS.crypto,
  other: ASSET_CLASS_LABELS.other,
};

export function bucketOf(c: AssetClass): MixBucket {
  return c === "us_stock" || c === "intl_stock" ? "stocks" : c;
}

/** Whole-number percentages per bucket; missing buckets are 0. */
export type MixWeights = Partial<Record<MixBucket, number>>;

export interface ReferenceMix {
  id: string;
  label: string;
  weights: MixWeights;
}

/**
 * Common textbook reference points, shown so a user can see how their mix
 * differs. They are not targets and not suggestions.
 */
export const REFERENCE_MIXES: ReferenceMix[] = [
  { id: "100-0", label: "100% stocks", weights: { stocks: 100 } },
  {
    id: "80-20",
    label: "80% stocks / 20% bonds",
    weights: { stocks: 80, bond: 20 },
  },
  {
    id: "60-40",
    label: "60% stocks / 40% bonds",
    weights: { stocks: 60, bond: 40 },
  },
  {
    id: "40-60",
    label: "40% stocks / 60% bonds",
    weights: { stocks: 40, bond: 60 },
  },
];

/** Problems with a custom mix; empty when it is usable. */
export function validateMix(weights: MixWeights): string[] {
  const problems: string[] = [];
  let sum = 0;
  for (const b of MIX_BUCKETS) {
    const v = weights[b] ?? 0;
    if (!Number.isInteger(v) || v < 0 || v > 100) {
      problems.push(
        `${MIX_BUCKET_LABELS[b]} must be a whole number from 0 to 100.`,
      );
    } else sum += v;
  }
  if (problems.length === 0 && sum !== 100)
    problems.push(
      `The percentages add up to ${sum}%; they must add up to 100%.`,
    );
  return problems;
}

export interface MixRow {
  bucket: MixBucket;
  label: string;
  actual_pct: number;
  reference_pct: number;
  /** actual - reference, in percentage points. */
  difference_pp: number;
}

/** Null when there are no valued holdings to compare. */
export function compareToMix(
  p: Portfolio,
  weights: MixWeights,
): MixRow[] | null {
  if (p.total_valued_cents <= 0) return null;
  const actual = new Map<MixBucket, number>();
  for (const s of p.by_class) {
    const b = bucketOf(s.key as AssetClass);
    actual.set(b, (actual.get(b) ?? 0) + s.pct);
  }
  return MIX_BUCKETS.filter(
    (b) => (actual.get(b) ?? 0) > 0 || (weights[b] ?? 0) > 0,
  ).map((b) => {
    const a = actual.get(b) ?? 0;
    const r = weights[b] ?? 0;
    return {
      bucket: b,
      label: MIX_BUCKET_LABELS[b],
      actual_pct: a,
      reference_pct: r,
      difference_pp: a - r,
    };
  });
}
