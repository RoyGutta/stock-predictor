/**
 * Versioned, validated local persistence.
 *
 * Two rules, both learned the hard way by anyone who has shipped localStorage:
 *
 * 1. **Everything it returns is untrusted.** The value may have been written by
 *    an older build with a different shape, hand-edited in devtools, or
 *    truncated by a full disk. Every read runs through a validator and falls
 *    back to the default rather than casting and hoping — a malformed blob
 *    must not be able to crash the app on load.
 *
 * 2. **It can throw at any moment.** Private browsing, blocked storage, and
 *    quota exhaustion all raise on perfectly ordinary calls. Persistence is a
 *    nicety; the feature it backs has to keep working without it.
 *
 * Keys carry a schema version. Bumping it retires old data cleanly instead of
 * trying to migrate a shape nobody remembers.
 */

const PREFIX = "stock-predictor";

/** Narrows an unknown parsed value to `T`, or returns null to fall back. */
export type Validator<T> = (value: unknown) => T | null;

export function storageKey(name: string, version = 1): string {
  return `${PREFIX}:${name}:v${version}`;
}

export function readStored<T>(key: string, validate: Validator<T>, fallback: T): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  try {
    return validate(JSON.parse(raw)) ?? fallback;
  } catch {
    // Corrupt or truncated JSON. Drop it rather than failing every load.
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, private browsing, or storage disabled by policy.
    // The caller's in-memory state is still correct; only durability is lost.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing meaningful to do */
  }
}

// --- shared validators ------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Finite numbers only: NaN and Infinity survive JSON round-trips as null but
 *  can arrive from a hand-edited blob, and would poison every calculation. */
export function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Maps each element through `item`, dropping any that fail rather than
 *  discarding the whole list for one bad entry. */
export function asArrayOf<T>(value: unknown, item: Validator<T>): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(item).filter((entry): entry is T => entry !== null);
}
