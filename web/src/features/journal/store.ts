import { useSyncExternalStore } from 'react';
import { JOURNAL_KEY, readEntries, writeEntries, type JournalEntry } from '../../lib/journal.ts';

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let cache: JournalEntry[] | null = null;
const listeners = new Set<() => void>();

export const journal = {
  get: (): JournalEntry[] => (cache ??= readEntries(storage())),
  /** Returns false when the browser refused to store it (private mode, quota). */
  set(next: JournalEntry[]): boolean {
    cache = next;
    const ok = writeEntries(storage(), next);
    for (const l of listeners) l();
    return ok;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    // another tab edited the notebook
    const onStorage = (e: StorageEvent) => {
      if (e.key !== JOURNAL_KEY) return;
      cache = null;
      l();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(l);
      window.removeEventListener('storage', onStorage);
    };
  },
};

export const useJournal = () => useSyncExternalStore(journal.subscribe, journal.get);
