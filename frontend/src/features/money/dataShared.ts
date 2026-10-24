/** Shared by the Backup & data cards. */
import type { ChangeEvent } from "react";

import type { MoneyState, Transaction } from "./model";

export interface DataProps {
  state: MoneyState;
  onRestore: (state: MoneyState) => void;
  onUndoRestore: () => boolean;
  onImport: (txs: Transaction[]) => void;
  onClearAll: () => void;
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function readFile(
  event: ChangeEvent<HTMLInputElement>,
  maxBytes: number,
): Promise<string> {
  const file = event.target.files?.[0];
  if (!file) throw new Error("No file chosen.");
  if (file.size > maxBytes) throw new Error("That file is too large.");
  return file.text();
}
