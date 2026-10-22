"use client";

import { useSyncExternalStore } from "react";

import {
  addSession,
  addWord,
  clampRate,
  emptyProgress,
  markReviewed,
  parseProgress,
  recordPracticeDay,
  removeWord,
  type NewWordInput,
  type ProgressData,
  type SessionRecord,
} from "@/lib/progress";

/**
 * Learning progress persisted in localStorage. Contains only learning data and UI preferences —
 * never API keys or other secrets.
 */
const STORAGE_KEY = "speakup.progress.v1";

export interface ProgressState {
  data: ProgressData;
  /** Set when localStorage is unavailable or full; progress then lives only in memory. */
  storageError: string | null;
}

let state: ProgressState | null = null;
const listeners = new Set<() => void>();

function load(): ProgressState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return { data: raw ? parseProgress(JSON.parse(raw)) : emptyProgress(), storageError: null };
  } catch {
    return {
      data: emptyProgress(),
      storageError: "Не удалось прочитать сохранённый прогресс: хранилище браузера недоступно. Прогресс будет храниться только до закрытия вкладки.",
    };
  }
}

function getSnapshot(): ProgressState {
  if (state === null) state = load();
  return state;
}

function getServerSnapshot(): ProgressState | null {
  return null;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    state = load();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function update(fn: (data: ProgressData) => ProgressData): void {
  const current = getSnapshot();
  const next = fn(current.data);
  if (next === current.data) return;
  let storageError: string | null = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    storageError = "Не удалось сохранить прогресс: хранилище браузера переполнено или недоступно.";
  }
  state = { data: next, storageError };
  emit();
}

export const progressActions = {
  setSpeechRate(rate: number) {
    update((data) => ({ ...data, speechRate: clampRate(rate) }));
  },
  setAutoSpeak(autoSpeak: boolean) {
    update((data) => (data.autoSpeak === autoSpeak ? data : { ...data, autoSpeak }));
  },
  /** Returns true if the word was added (false if it was already saved). */
  saveWord(input: NewWordInput): boolean {
    let added = false;
    update((data) => {
      const result = addWord(data, input, new Date(), crypto.randomUUID());
      added = result.added;
      return result.data;
    });
    return added;
  },
  removeWord(id: string) {
    update((data) => removeWord(data, id));
  },
  markReviewed(id: string) {
    update((data) => markReviewed(data, id, new Date()));
  },
  recordPractice() {
    update((data) => recordPracticeDay(data, new Date()));
  },
  recordSession(record: SessionRecord) {
    update((data) => addSession(data, record));
  },
};

/** null until hydrated on the client (server render has no access to localStorage). */
export function useProgress(): ProgressState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
