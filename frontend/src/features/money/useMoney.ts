import { useCallback, useEffect, useRef, useState } from "react";

import type { Account, MoneyState, Transaction } from "./model";
import {
  clearMoney,
  loadMoney,
  readPreRestore,
  saveMoney,
  snapshotBeforeRestore,
  type LoadResult,
} from "./store";

export interface MoneyApi {
  state: MoneyState;
  load: LoadResult;
  /** False when the browser refused the last write (quota, private mode, policy). */
  saved: boolean;
  upsertAccount: (account: Account) => void;
  deleteAccount: (id: string) => void;
  upsertTransaction: (tx: Transaction) => void;
  deleteTransaction: (id: string) => void;
  addTransactions: (txs: Transaction[]) => void;
  addCategory: (name: string) => void;
  replaceAll: (state: MoneyState) => void;
  undoRestore: () => boolean;
  clearAll: () => void;
}

/**
 * Money Manager state, persisted to this browser on every change. Pure local
 * state: no request is ever made from here.
 */
export function useMoney(): MoneyApi {
  const [load] = useState<LoadResult>(() => loadMoney());
  const [state, setState] = useState<MoneyState>(load.state);
  const [saved, setSaved] = useState(true);
  const first = useRef(true);

  useEffect(() => {
    // Do not write back on mount: a newer-version document must stay untouched.
    if (first.current) {
      first.current = false;
      return;
    }
    // Data written by a newer build is never overwritten by this one.
    if (load.newer_version !== null) {
      setSaved(false);
      return;
    }
    setSaved(saveMoney(state));
  }, [state, load.newer_version]);

  const update = useCallback(
    (fn: (s: MoneyState) => MoneyState) => setState((s) => fn(s)),
    [],
  );

  return {
    state,
    load,
    saved,
    upsertAccount: (account) =>
      update((s) => ({
        ...s,
        accounts: s.accounts.some((a) => a.id === account.id)
          ? s.accounts.map((a) => (a.id === account.id ? account : a))
          : [...s.accounts, account],
      })),
    deleteAccount: (id) =>
      update((s) => ({
        ...s,
        accounts: s.accounts.filter((a) => a.id !== id),
        transactions: s.transactions.filter(
          (t) => t.account_id !== id && t.to_account_id !== id,
        ),
      })),
    upsertTransaction: (tx) =>
      update((s) => ({
        ...s,
        transactions: s.transactions.some((t) => t.id === tx.id)
          ? s.transactions.map((t) => (t.id === tx.id ? tx : t))
          : [...s.transactions, tx],
      })),
    deleteTransaction: (id) =>
      update((s) => ({
        ...s,
        transactions: s.transactions.filter((t) => t.id !== id),
      })),
    addTransactions: (txs) =>
      update((s) => ({ ...s, transactions: [...s.transactions, ...txs] })),
    addCategory: (name) =>
      update((s) =>
        s.categories.includes(name)
          ? s
          : { ...s, categories: [...s.categories, name] },
      ),
    replaceAll: (next) => {
      snapshotBeforeRestore();
      setState(next);
    },
    undoRestore: () => {
      const previous = readPreRestore();
      if (!previous) return false;
      setState(previous);
      return true;
    },
    clearAll: () => {
      clearMoney();
      first.current = true; // the cleared state must not be written straight back
      setState({ ...load.state, accounts: [], transactions: [] });
    },
  };
}
