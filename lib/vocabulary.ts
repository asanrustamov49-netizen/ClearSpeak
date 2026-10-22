import type { VocabularyItem } from "./types";

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Merges new items into a list, skipping words that are already there (case-insensitive). */
export function mergeVocabulary(existing: readonly VocabularyItem[], incoming: readonly VocabularyItem[]): VocabularyItem[] {
  const seen = new Set(existing.map((item) => normalizeWord(item.word)));
  const merged = [...existing];
  for (const item of incoming) {
    const key = normalizeWord(item.word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}
