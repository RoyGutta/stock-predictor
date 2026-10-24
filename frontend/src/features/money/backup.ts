/**
 * Encrypted backups, made and opened entirely in this browser (Web Crypto).
 *
 * Key: PBKDF2-SHA-256 over the user's passphrase, 600,000 iterations, random
 * 16-byte salt. Cipher: AES-256-GCM with a random 12-byte IV, which both
 * encrypts and authenticates: a wrong passphrase and a tampered file fail the
 * same way, and nothing partial is ever restored. The envelope's format,
 * version, and KDF parameters are bound into the ciphertext as associated data,
 * so editing them also fails authentication.
 *
 * The passphrase is never stored or sent anywhere. Lose it and the backup
 * cannot be opened; there is no recovery.
 */

import { isRecord } from "../../lib/storage";
import type { MoneyState } from "./model";
import { parseState } from "./store";

export const BACKUP_FORMAT = "stock-predictor-money-backup";
export const BACKUP_VERSION = 1;
const ITERATIONS = 600_000;
const MIN_PASSPHRASE = 10;
const MAX_BACKUP_BYTES = 20_000_000;

export class BackupError extends Error {}

interface Envelope {
  format: string;
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  created_at: string;
  ciphertext: string;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function associatedData(
  e: Omit<Envelope, "ciphertext" | "created_at">,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      e.format,
      e.version,
      e.kdf.name,
      e.kdf.hash,
      e.kdf.iterations,
      e.kdf.salt,
      e.cipher.iv,
    ]),
  );
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function passphraseProblem(passphrase: string): string | null {
  return passphrase.length < MIN_PASSPHRASE
    ? `Use a passphrase of at least ${MIN_PASSPHRASE} characters.`
    : null;
}

export async function createBackup(
  state: MoneyState,
  passphrase: string,
  { iterations = ITERATIONS, now = new Date() } = {},
): Promise<string> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new BackupError(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: {
      name: "PBKDF2" as const,
      hash: "SHA-256" as const,
      iterations,
      salt: b64(salt),
    },
    cipher: { name: "AES-GCM" as const, iv: b64(iv) },
  };
  const key = await deriveKey(passphrase, salt, iterations);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(header) },
    key,
    plaintext,
  );
  const envelope: Envelope = {
    ...header,
    created_at: now.toISOString(),
    ciphertext: b64(new Uint8Array(sealed)),
  };
  return JSON.stringify(envelope);
}

function parseEnvelope(text: string): Envelope {
  if (text.length > MAX_BACKUP_BYTES)
    throw new BackupError("This file is too large to be a backup.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("This file is not a Stock Predictor backup.");
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError("This file is not a Stock Predictor backup.");
  }
  if (raw.version !== BACKUP_VERSION) {
    throw new BackupError(
      `This backup uses format version ${String(raw.version)}, which this version of the app cannot read.`,
    );
  }
  const kdf = raw.kdf;
  const cipher = raw.cipher;
  if (
    !isRecord(kdf) ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    typeof kdf.iterations !== "number" ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < 100_000 ||
    kdf.iterations > 10_000_000 ||
    typeof kdf.salt !== "string" ||
    !isRecord(cipher) ||
    cipher.name !== "AES-GCM" ||
    typeof cipher.iv !== "string" ||
    typeof raw.ciphertext !== "string"
  ) {
    throw new BackupError("This backup file is damaged or incomplete.");
  }
  return raw as unknown as Envelope;
}

/** Decrypt and validate. Throws BackupError with a user-safe message; never returns partial data. */
export async function openBackup(
  text: string,
  passphrase: string,
): Promise<{ state: MoneyState; dropped: number; created_at: string }> {
  const envelope = parseEnvelope(text);
  let salt: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array;
  try {
    salt = unb64(envelope.kdf.salt);
    iv = unb64(envelope.cipher.iv);
    ciphertext = unb64(envelope.ciphertext);
  } catch {
    throw new BackupError("This backup file is damaged or incomplete.");
  }
  if (salt.length !== 16 || iv.length !== 12)
    throw new BackupError("This backup file is damaged or incomplete.");
  const key = await deriveKey(passphrase, salt, envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(envelope) },
      key,
      ciphertext,
    );
  } catch {
    throw new BackupError(
      "Wrong passphrase, or the backup file has been altered. Nothing was restored.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new BackupError(
      "The backup decrypted but its contents are not valid. Nothing was restored.",
    );
  }
  const parsed = parseState(decoded);
  if (!parsed) {
    throw new BackupError(
      "The backup's contents are from an incompatible version or are invalid. Nothing was restored.",
    );
  }
  return {
    ...parsed,
    created_at:
      typeof envelope.created_at === "string" ? envelope.created_at : "",
  };
}
