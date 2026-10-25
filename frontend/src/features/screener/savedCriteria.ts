/**
 * Named screening criteria, persisted through the validated storage helpers.
 * Anything read back is untrusted: malformed entries are dropped one by one.
 */
import {
  asArrayOf,
  asFiniteNumber,
  asString,
  isRecord,
  readStored,
  storageKey,
  writeStored,
} from "../../lib/storage";
import type { ScreenerCriteria, SizeBandKey } from "../../types/screener";

export const SAVED_KEY = storageKey("screener-criteria");
export const MAX_SAVED = 20;

export interface SavedCriteria {
  name: string;
  criteria: ScreenerCriteria;
}

export const DEFAULT_CRITERIA: ScreenerCriteria = {
  minRevenue: null,
  minGrowth: null,
  maxGrowth: null,
  minNetMargin: null,
  maxLiabilitiesToAssets: null,
  positiveFcf: false,
  name: "",
  sizeBand: null,
};

export const SIZE_BAND_LABELS: Record<SizeBandKey, string> = {
  "100b_plus": "$100B or more",
  "10b_100b": "$10B to $100B",
  "1b_10b": "$1B to $10B",
  "100m_1b": "$100M to $1B",
  under_100m: "Under $100M",
};

function isSizeBand(value: unknown): value is SizeBandKey {
  return typeof value === "string" && value in SIZE_BAND_LABELS;
}

function optionalNumber(value: unknown): number | null {
  return asFiniteNumber(value);
}

export function validateCriteria(value: unknown): ScreenerCriteria | null {
  if (!isRecord(value)) return null;
  return {
    minRevenue: optionalNumber(value.minRevenue),
    minGrowth: optionalNumber(value.minGrowth),
    maxGrowth: optionalNumber(value.maxGrowth),
    minNetMargin: optionalNumber(value.minNetMargin),
    maxLiabilitiesToAssets: optionalNumber(value.maxLiabilitiesToAssets),
    positiveFcf: value.positiveFcf === true,
    name: (asString(value.name) ?? "").slice(0, 80),
    sizeBand: isSizeBand(value.sizeBand) ? value.sizeBand : null,
  };
}

function validateSaved(value: unknown): SavedCriteria | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name)?.trim();
  const criteria = validateCriteria(value.criteria);
  if (!name || !criteria) return null;
  return { name: name.slice(0, 60), criteria };
}

export function readSaved(): SavedCriteria[] {
  return readStored(
    SAVED_KEY,
    (value) => asArrayOf(value, validateSaved)?.slice(0, MAX_SAVED) ?? null,
    [],
  );
}

/** Saving under an existing name replaces that entry. */
export function upsertSaved(
  list: SavedCriteria[],
  entry: SavedCriteria,
): SavedCriteria[] {
  const rest = list.filter((item) => item.name !== entry.name);
  const next = [entry, ...rest].slice(0, MAX_SAVED);
  writeStored(SAVED_KEY, next);
  return next;
}

export function removeSaved(
  list: SavedCriteria[],
  name: string,
): SavedCriteria[] {
  const next = list.filter((item) => item.name !== name);
  writeStored(SAVED_KEY, next);
  return next;
}
