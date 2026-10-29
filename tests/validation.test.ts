import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_HISTORY_MESSAGES, MAX_USER_MESSAGE_CHARS } from "../lib/constants.ts";
import {
  parseChatRequest,
  parseCoachReply,
  parseHintsRequest,
  parseHintsResult,
  parseSummaryRequest,
  parseTranslateRequest,
} from "../lib/validation.ts";

describe("parseChatRequest", () => {
  const base = { level: "beginner", topic: "travel" };

  it("accepts an empty history (session start)", () => {
    const result = parseChatRequest({ ...base, messages: [] });
    assert.deepEqual(result, { ok: true, value: { ...base, messages: [], knownWords: [] } });
  });

  it("trims message content and keeps known words", () => {
    const result = parseChatRequest({
      ...base,
      messages: [
        { role: "assistant", content: " Hi! " },
        { role: "user", content: "  Hello  " },
      ],
      knownWords: ["fare", 42, "  "],
    });
    assert.ok(result.ok);
    assert.equal(result.value.messages[1].content, "Hello");
    assert.deepEqual(result.value.knownWords, ["fare"]);
  });

  it("rejects unknown level, topic and role", () => {
    assert.equal(parseChatRequest({ ...base, level: "expert", messages: [] }).ok, false);
    assert.equal(parseChatRequest({ ...base, topic: "space", messages: [] }).ok, false);
    assert.equal(parseChatRequest({ ...base, messages: [{ role: "system", content: "x" }] }).ok, false);
  });

  it("rejects non-object bodies and missing messages", () => {
    assert.equal(parseChatRequest(null).ok, false);
    assert.equal(parseChatRequest([]).ok, false);
    assert.equal(parseChatRequest(base).ok, false);
  });

  it("rejects empty and too long user messages", () => {
    assert.equal(parseChatRequest({ ...base, messages: [{ role: "user", content: "   " }] }).ok, false);
    const long = "a".repeat(MAX_USER_MESSAGE_CHARS + 1);
    assert.equal(parseChatRequest({ ...base, messages: [{ role: "user", content: long }] }).ok, false);
  });

  it("rejects history longer than the limit", () => {
    const messages = Array.from({ length: MAX_HISTORY_MESSAGES + 1 }, () => ({ role: "user", content: "hi" }));
    assert.equal(parseChatRequest({ ...base, messages }).ok, false);
  });

  it("requires the last message to come from the user", () => {
    const result = parseChatRequest({ ...base, messages: [{ role: "assistant", content: "Hi" }] });
    assert.equal(result.ok, false);
  });
});

describe("other request parsers", () => {
  const base = { level: "intermediate", topic: "restaurant" };

  it("hints need the AI's line last", () => {
    assert.equal(parseHintsRequest({ ...base, messages: [{ role: "assistant", content: "Ready to order?" }] }).ok, true);
    assert.equal(parseHintsRequest({ ...base, messages: [{ role: "user", content: "Hi" }] }).ok, false);
    assert.equal(parseHintsRequest({ ...base, messages: [] }).ok, false);
  });

  it("summary needs at least one learner message", () => {
    assert.equal(parseSummaryRequest({ ...base, messages: [{ role: "assistant", content: "Hi" }] }).ok, false);
    assert.equal(
      parseSummaryRequest({ ...base, messages: [{ role: "assistant", content: "Hi" }, { role: "user", content: "Hello" }] }).ok,
      true,
    );
  });

  it("translate validates the phrase length", () => {
    assert.equal(parseTranslateRequest({ level: "beginner", phrase: "fare", context: "Your fare is $2." }).ok, true);
    assert.equal(parseTranslateRequest({ level: "beginner", phrase: "x".repeat(81), context: "" }).ok, false);
    assert.equal(parseTranslateRequest({ level: "beginner", phrase: "  ", context: "" }).ok, false);
  });

  it("hints result needs at least two valid hints", () => {
    assert.equal(parseHintsResult({ hints: [{ text: "Yes", translation: "Да" }] }), null);
    assert.equal(
      parseHintsResult({
        hints: [
          { text: "Yes, please.", translation: "Да, пожалуйста." },
          { text: "Not yet.", translation: "Пока нет." },
        ],
      })?.hints.length,
      2,
    );
  });
});

describe("parseCoachReply", () => {
  const valid = {
    reply: "What a great trip! Where did you go?",
    corrections: [{ original: "I go", corrected: "I went", explanation: "Прошедшее время." }],
    vocabulary: [{ word: "trip", translation: "поездка", note: "" }],
    hints: [
      { text: "I went to Rome.", translation: "Я ездил в Рим." },
      { text: "We visited Paris.", translation: "Мы посетили Париж." },
    ],
    goalAchieved: false,
  };

  it("accepts a valid reply", () => {
    assert.deepEqual(parseCoachReply(valid, { isOpening: false }), valid);
  });

  it("returns null when reply text or arrays are missing", () => {
    assert.equal(parseCoachReply({ ...valid, reply: "  " }, { isOpening: false }), null);
    assert.equal(parseCoachReply({ reply: "Hi", corrections: [] }, { isOpening: false }), null);
    assert.equal(parseCoachReply("not an object", { isOpening: false }), null);
  });

  it("drops vocabulary that does not occur in the reply, and duplicates", () => {
    const result = parseCoachReply(
      {
        ...valid,
        vocabulary: [
          { word: "trip", translation: "поездка", note: "" },
          { word: "Trip", translation: "поездка", note: "" },
          { word: "luggage", translation: "багаж", note: "" },
        ],
      },
      { isOpening: false },
    );
    assert.deepEqual(
      result?.vocabulary.map((item) => item.word),
      ["trip"],
    );
  });

  it("treats missing hints as empty and goalAchieved only when strictly true", () => {
    const result = parseCoachReply({ ...valid, hints: undefined, goalAchieved: "yes" }, { isOpening: false });
    assert.deepEqual(result?.hints, []);
    assert.equal(result?.goalAchieved, false);
  });

  it("drops malformed and no-op corrections instead of inventing them", () => {
    const result = parseCoachReply(
      {
        ...valid,
        corrections: [
          { original: "same", corrected: "same", explanation: "Ничего." },
          { original: "I go", corrected: "", explanation: "x" },
          { original: 42, corrected: "x", explanation: "x" },
        ],
      },
      { isOpening: false },
    );
    assert.deepEqual(result?.corrections, []);
  });

  it("keeps at most three corrections", () => {
    const corrections = Array.from({ length: 5 }, (_, i) => ({ original: `a${i}`, corrected: `b${i}`, explanation: "x" }));
    assert.equal(parseCoachReply({ ...valid, corrections }, { isOpening: false })?.corrections.length, 3);
  });

  it("ignores corrections on the opening message", () => {
    assert.deepEqual(parseCoachReply(valid, { isOpening: true })?.corrections, []);
  });
});
