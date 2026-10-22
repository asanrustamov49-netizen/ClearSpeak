import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { wordsToAnki, wordsToCsv } from "../lib/export.ts";
import { comparePhrase } from "../lib/phraseMatch.ts";
import {
  addWord,
  computeStreak,
  dueWords,
  emptyProgress,
  localDateKey,
  markReviewed,
  parseProgress,
  recordPracticeDay,
  type SavedWord,
} from "../lib/progress.ts";
import { sentenceAround, tokenizeMessage } from "../lib/tokenize.ts";
import { parseSessionSummary } from "../lib/validation.ts";

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("computeStreak", () => {
  it("is 0 before the first practice", () => {
    assert.equal(computeStreak([], day(2026, 10, 15)), 0);
  });

  it("counts consecutive local days ending today", () => {
    assert.equal(computeStreak(["2026-10-13", "2026-10-14", "2026-10-15"], day(2026, 10, 15)), 3);
  });

  it("stays alive until today ends if yesterday was practised", () => {
    assert.equal(computeStreak(["2026-10-13", "2026-10-14"], day(2026, 10, 15)), 2);
  });

  it("resets after a missed full day", () => {
    assert.equal(computeStreak(["2026-10-12", "2026-10-13"], day(2026, 10, 15)), 0);
  });

  it("works across month boundaries", () => {
    assert.equal(computeStreak(["2026-09-30", "2026-10-01"], day(2026, 10, 1)), 2);
  });

  it("does not double-count several sessions on one day", () => {
    let data = emptyProgress();
    data = recordPracticeDay(data, day(2026, 10, 15, 9));
    data = recordPracticeDay(data, day(2026, 10, 15, 21));
    assert.deepEqual(data.practiceDays, ["2026-10-15"]);
  });

  it("uses local dates, not UTC", () => {
    assert.equal(localDateKey(day(2026, 10, 15, 23)), "2026-10-15");
    assert.equal(localDateKey(day(2026, 10, 15, 0)), "2026-10-15");
  });
});

describe("dictionary", () => {
  it("does not add duplicates", () => {
    const first = addWord(emptyProgress(), { word: "Check in", translation: "регистрироваться", source: "lesson" }, day(2026, 10, 1), "a");
    const second = addWord(first.data, { word: "check  in", translation: "x", source: "tap" }, day(2026, 10, 2), "b");
    assert.equal(first.added, true);
    assert.equal(second.added, false);
    assert.equal(second.data.words.length, 1);
  });

  it("schedules reviews for words from earlier days only", () => {
    let data = addWord(emptyProgress(), { word: "luggage", translation: "багаж", source: "lesson" }, day(2026, 10, 14), "w1").data;
    data = addWord(data, { word: "fare", translation: "плата за проезд", source: "lesson" }, day(2026, 10, 15, 8), "w2").data;
    assert.deepEqual(
      dueWords(data, day(2026, 10, 15)).map((w) => w.id),
      ["w1"],
    );
    data = markReviewed(data, "w1", day(2026, 10, 15));
    assert.deepEqual(dueWords(data, day(2026, 10, 15)), []);
    // After one review the next interval is 2 days.
    assert.deepEqual(
      dueWords(data, day(2026, 10, 16)).map((w) => w.id),
      ["w2"],
    );
    assert.deepEqual(
      dueWords(data, day(2026, 10, 17)).map((w) => w.id),
      ["w1", "w2"],
    );
  });

  it("parses stored data defensively", () => {
    const parsed = parseProgress({
      speechRate: 5,
      words: [{ word: "ok", translation: "ок", addedAt: "2026-10-01T10:00:00Z" }, { word: "", translation: "x" }, "junk"],
      practiceDays: ["2026-10-01", "nope", "2026-10-01"],
      sessions: [{ finishedAt: "bad" }],
    });
    assert.equal(parsed.speechRate, 1.3);
    assert.equal(parsed.words.length, 1);
    assert.deepEqual(parsed.practiceDays, ["2026-10-01"]);
    assert.deepEqual(parsed.sessions, []);
    assert.deepEqual(parseProgress("garbage"), emptyProgress());
  });
});

describe("export", () => {
  const words: SavedWord[] = [
    {
      id: "1",
      word: '=HYPERLINK("x")',
      translation: 'формула, "кавычки"',
      note: "строка\nперенос",
      context: "",
      addedAt: "2026-10-15T08:00:00.000Z",
      source: "tap",
      topic: null,
      reviews: [],
    },
  ];

  it("writes CSV with BOM, escaping and formula protection", () => {
    const csv = wordsToCsv(words);
    assert.ok(csv.startsWith("﻿English,Russian,Example,Context,Added\r\n"));
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
    assert.ok(csv.includes(`"формула, ""кавычки"""`));
    assert.ok(csv.includes(`"строка\nперенос"`));
  });

  it("writes Anki tab-separated notes with headers", () => {
    const anki = wordsToAnki(words).split("\n");
    assert.equal(anki[0], "#separator:Tab");
    assert.equal(anki[1], "#html:false");
    const fields = anki[4].split("\t");
    assert.equal(fields.length, 4);
    assert.equal(fields[2], "строка перенос");
    assert.equal(fields[3], "2026-10-15");
  });
});

describe("comparePhrase", () => {
  it("ignores case, spaces and punctuation", () => {
    assert.equal(comparePhrase("I went to Italy.", "i went  to italy").verdict, "match");
  });

  it("reports close and different results with missing words", () => {
    const close = comparePhrase("We were very happy", "we was very happy");
    assert.equal(close.verdict, "close");
    assert.deepEqual(close.missing, ["were"]);
    assert.equal(comparePhrase("We were very happy", "good morning").verdict, "different");
  });
});

describe("tokenizeMessage", () => {
  it("keeps known phrases together and splits other words", () => {
    const tokens = tokenizeMessage("Would you like to check in now?", ["check in"]);
    assert.deepEqual(
      tokens.filter((t) => t.kind !== "text").map((t) => t.value),
      ["Would", "you", "like", "to", "check in", "now"],
    );
  });

  it("finds the sentence around a phrase", () => {
    assert.equal(sentenceAround("Hi there. Your fare is two euros. Enjoy!", "fare"), "Your fare is two euros.");
  });
});

describe("parseSessionSummary", () => {
  const messages = [
    { role: "assistant" as const, content: "Welcome! What can I get you?" },
    { role: "user" as const, content: "I want a steak medium and we pay separate" },
  ];
  const raw = {
    topErrors: [
      { example: "we pay separate", corrected: "we'd like to pay separately", explanation: "Наречие." },
      { example: "I goed home", corrected: "I went home", explanation: "Выдумано." },
    ],
    newWords: [
      { word: "steak", translation: "стейк" },
      { word: "sirloin", translation: "вырезка" },
    ],
    nextSessionTip: "Тренируйте вежливые просьбы.",
    goal: { status: "completed", comment: "Заказал стейк и раздельный счёт." },
  };

  it("keeps only errors and words that really occur in the dialogue", () => {
    const summary = parseSessionSummary(raw, { messages, hasGoal: true });
    assert.deepEqual(
      summary?.topErrors.map((e) => e.example),
      ["we pay separate"],
    );
    assert.deepEqual(
      summary?.newWords.map((w) => w.word),
      ["steak"],
    );
    assert.equal(summary?.goal.status, "completed");
  });

  it("forces not_applicable without a scenario goal", () => {
    assert.equal(parseSessionSummary(raw, { messages, hasGoal: false })?.goal.status, "not_applicable");
  });

  it("rejects a summary without a tip", () => {
    assert.equal(parseSessionSummary({ ...raw, nextSessionTip: "" }, { messages, hasGoal: true }), null);
  });
});
