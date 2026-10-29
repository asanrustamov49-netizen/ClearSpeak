import { DEFAULT_SPEECH_RATE, LEVEL_IDS, MAX_SPEECH_RATE, MAX_WORD_CHARS, MIN_SPEECH_RATE, TOPIC_IDS } from "./constants.ts";
import type { GoalStatus, LevelId, TopicId } from "./types";
import { normalizeWord } from "./vocabulary.ts";

export const PROGRESS_VERSION = 1;
const MAX_WORDS = 2000;
const MAX_DAYS = 400;
const MAX_SESSIONS = 50;
const MAX_REVIEWS_PER_WORD = 30;
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30, 60];

export interface SavedWord {
  id: string;
  word: string;
  translation: string;
  note: string;
  context: string;
  addedAt: string;
  source: "lesson" | "tap" | "summary";
  topic: TopicId | null;
  reviews: string[];
}

export interface SessionRecord {
  id: string;
  finishedAt: string;
  level: LevelId;
  topic: TopicId;
  turns: number;
  newWords: number;
  goal: GoalStatus | null;
}

export interface ProgressData {
  version: number;
  speechRate: number;
  autoSpeak: boolean;
  words: SavedWord[];
  practiceDays: string[];
  sessions: SessionRecord[];
}

export function emptyProgress(): ProgressData {
  return { version: PROGRESS_VERSION, speechRate: DEFAULT_SPEECH_RATE, autoSpeak: false, words: [], practiceDays: [], sessions: [] };
}

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  return Math.round(Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate)) * 100) / 100;
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + days, 12));
}

export function computeStreak(practiceDays: readonly string[], today: Date): number {
  const days = new Set(practiceDays);
  const todayKey = localDateKey(today);
  let cursor = days.has(todayKey) ? todayKey : shiftDay(todayKey, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export function recordPracticeDay(data: ProgressData, now: Date): ProgressData {
  const key = localDateKey(now);
  if (data.practiceDays.includes(key)) return data;
  const practiceDays = [...data.practiceDays, key].sort().slice(-MAX_DAYS);
  return { ...data, practiceDays };
}

export function findWord(data: ProgressData, word: string): SavedWord | undefined {
  const key = normalizeWord(word);
  return data.words.find((item) => normalizeWord(item.word) === key);
}

export interface NewWordInput {
  word: string;
  translation: string;
  note?: string;
  context?: string;
  source: SavedWord["source"];
  topic?: TopicId | null;
}

export function addWord(data: ProgressData, input: NewWordInput, now: Date, id: string): { data: ProgressData; added: boolean } {
  const word = input.word.trim().slice(0, MAX_WORD_CHARS);
  const translation = input.translation.trim();
  if (!word || !translation || findWord(data, word)) return { data, added: false };
  const saved: SavedWord = {
    id,
    word,
    translation,
    note: input.note?.trim() ?? "",
    context: input.context?.trim().slice(0, 300) ?? "",
    addedAt: now.toISOString(),
    source: input.source,
    topic: input.topic ?? null,
    reviews: [],
  };
  return { data: { ...data, words: [...data.words, saved].slice(-MAX_WORDS) }, added: true };
}

export function removeWord(data: ProgressData, id: string): ProgressData {
  return { ...data, words: data.words.filter((word) => word.id !== id) };
}

export function markReviewed(data: ProgressData, id: string, now: Date): ProgressData {
  return {
    ...data,
    words: data.words.map((word) =>
      word.id === id ? { ...word, reviews: [...word.reviews, now.toISOString()].slice(-MAX_REVIEWS_PER_WORD) } : word,
    ),
  };
}

export function dueWords(data: ProgressData, now: Date): SavedWord[] {
  const todayKey = localDateKey(now);
  return data.words.filter((word) => {
    const addedKey = localDateKey(new Date(word.addedAt));
    if (addedKey >= todayKey) return false;
    const last = word.reviews.length ? word.reviews[word.reviews.length - 1] : word.addedAt;
    const lastKey = localDateKey(new Date(last));
    if (lastKey >= todayKey) return false;
    const interval = REVIEW_INTERVALS[Math.min(word.reviews.length, REVIEW_INTERVALS.length - 1)];
    return shiftDay(lastKey, interval) <= todayKey;
  });
}

export function addSession(data: ProgressData, record: SessionRecord): ProgressData {
  const sessions = [...data.sessions.filter((item) => item.id !== record.id), record].slice(-MAX_SESSIONS);
  return { ...data, sessions };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return value === "completed" || value === "partial" || value === "not_completed" || value === "not_applicable";
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseProgress(raw: unknown): ProgressData {
  const base = emptyProgress();
  if (typeof raw !== "object" || raw === null) return base;
  const value = raw as Record<string, unknown>;

  const words: SavedWord[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.words)) {
    for (const item of value.words) {
      if (typeof item !== "object" || item === null) continue;
      const w = item as Record<string, unknown>;
      const word = str(w.word).trim();
      const translation = str(w.translation).trim();
      const key = normalizeWord(word);
      if (!word || !translation || !isIsoDate(w.addedAt) || seen.has(key)) continue;
      seen.add(key);
      words.push({
        id: str(w.id) || `w-${words.length}-${key}`,
        word: word.slice(0, MAX_WORD_CHARS),
        translation,
        note: str(w.note),
        context: str(w.context),
        addedAt: w.addedAt,
        source: w.source === "tap" || w.source === "summary" ? w.source : "lesson",
        topic: typeof w.topic === "string" && (TOPIC_IDS as readonly string[]).includes(w.topic) ? (w.topic as TopicId) : null,
        reviews: Array.isArray(w.reviews) ? w.reviews.filter(isIsoDate).slice(-MAX_REVIEWS_PER_WORD) : [],
      });
    }
  }

  const practiceDays = Array.isArray(value.practiceDays)
    ? [...new Set(value.practiceDays.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-MAX_DAYS)
    : [];

  const sessions: SessionRecord[] = Array.isArray(value.sessions)
    ? value.sessions
        .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
        .filter(
          (s) =>
            isIsoDate(s.finishedAt) &&
            typeof s.level === "string" &&
            (LEVEL_IDS as readonly string[]).includes(s.level) &&
            typeof s.topic === "string" &&
            (TOPIC_IDS as readonly string[]).includes(s.topic),
        )
        .map((s) => ({
          id: str(s.id) || str(s.finishedAt),
          finishedAt: s.finishedAt as string,
          level: s.level as LevelId,
          topic: s.topic as TopicId,
          turns: typeof s.turns === "number" && s.turns >= 0 ? Math.floor(s.turns) : 0,
          newWords: typeof s.newWords === "number" && s.newWords >= 0 ? Math.floor(s.newWords) : 0,
          goal: isGoalStatus(s.goal) ? s.goal : null,
        }))
        .slice(-MAX_SESSIONS)
    : [];

  return {
    version: PROGRESS_VERSION,
    speechRate: clampRate(typeof value.speechRate === "number" ? value.speechRate : DEFAULT_SPEECH_RATE),
    autoSpeak: value.autoSpeak === true,
    words: words.slice(-MAX_WORDS),
    practiceDays,
    sessions,
  };
}
