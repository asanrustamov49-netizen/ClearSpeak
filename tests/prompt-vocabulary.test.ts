import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSummaryPrompt, buildSystemPrompt, COACH_REPLY_SCHEMA, SUMMARY_SCHEMA } from "../lib/prompt.ts";
import { mergeVocabulary } from "../lib/vocabulary.ts";

describe("buildSystemPrompt", () => {
  it("reflects level, scenario roles, goal and known words", () => {
    const prompt = buildSystemPrompt("beginner", "restaurant", false, ["menu"]);
    assert.match(prompt, /BEGINNER/);
    assert.match(prompt, /waiter/);
    assert.match(prompt, /split the bill/);
    assert.match(prompt, /IN RUSSIAN/);
    assert.match(prompt, /menu/);
  });

  it("asks for no corrections on the opening line", () => {
    const prompt = buildSystemPrompt("advanced", "job-interview", true);
    assert.match(prompt, /opening line/);
    assert.match(prompt, /EMPTY `corrections`/);
  });

  it("has no task for free conversation", () => {
    const prompt = buildSystemPrompt("intermediate", "free-conversation", false);
    assert.match(prompt, /no fixed task/);
    assert.match(prompt, /always false/);
  });

  it("schemas require all fields (needed for strict json_schema)", () => {
    assert.deepEqual([...COACH_REPLY_SCHEMA.required].sort(), ["corrections", "goalAchieved", "hints", "reply", "vocabulary"]);
    assert.equal(COACH_REPLY_SCHEMA.additionalProperties, false);
    assert.deepEqual([...SUMMARY_SCHEMA.required].sort(), ["goal", "newWords", "nextSessionTip", "topErrors"]);
  });

  it("summary prompt includes the success criteria", () => {
    assert.match(buildSummaryPrompt("beginner", "travel"), /how much the trip/);
  });
});

describe("mergeVocabulary", () => {
  it("skips duplicates case-insensitively", () => {
    const merged = mergeVocabulary(
      [{ word: "Trip", translation: "поездка", note: "" }],
      [
        { word: "trip ", translation: "поездка", note: "" },
        { word: "luggage", translation: "багаж", note: "" },
      ],
    );
    assert.deepEqual(
      merged.map((item) => item.word),
      ["Trip", "luggage"],
    );
  });
});
