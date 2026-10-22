import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectImageMime } from "../lib/imageMime.ts";
import { readStreamingStringField } from "../lib/partialJson.ts";
import { buildSystemPrompt } from "../lib/prompt.ts";
import { parseChatRequest, parseImageDescription, parseImageTopic } from "../lib/validation.ts";

describe("readStreamingStringField", () => {
  it("returns null until the field value starts", () => {
    assert.equal(readStreamingStringField("", "reply"), null);
    assert.equal(readStreamingStringField('{"rep', "reply"), null);
    assert.equal(readStreamingStringField('{"reply": ', "reply"), null);
  });

  it("returns the partial value while it streams", () => {
    assert.equal(readStreamingStringField('{"reply":"Hello, wel', "reply"), "Hello, wel");
    assert.equal(readStreamingStringField('{\n  "reply" : "Hi', "reply"), "Hi");
  });

  it("stops at the closing quote and decodes escapes", () => {
    assert.equal(readStreamingStringField('{"reply":"Say \\"hi\\"\\nnow","corrections":[', "reply"), 'Say "hi"\nnow');
    assert.equal(readStreamingStringField('{"reply":"caf\\u00e9 time"}', "reply"), "café time");
  });

  it("does not emit half-finished escapes", () => {
    assert.equal(readStreamingStringField('{"reply":"a\\', "reply"), "a");
    assert.equal(readStreamingStringField('{"reply":"a\\u00', "reply"), "a");
  });

  it("only reads the field when it is the first key", () => {
    assert.equal(readStreamingStringField('{"corrections":[],"reply":"x"}', "reply"), null);
  });
});

describe("detectImageMime", () => {
  it("recognises real image signatures only", () => {
    assert.equal(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    assert.equal(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
    assert.equal(
      detectImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
      "image/webp",
    );
    assert.equal(detectImageMime(new TextEncoder().encode("<html>not an image</html>")), null);
    assert.equal(detectImageMime(new Uint8Array([])), null);
  });
});

describe("image validation", () => {
  it("accepts a normal topic and rejects markup, too short or too long ones", () => {
    assert.deepEqual(parseImageTopic("  A cozy   café in London "), { ok: true, value: "A cozy café in London" });
    assert.equal(parseImageTopic("ab").ok, false);
    assert.equal(parseImageTopic("<script>").ok, false);
    assert.equal(parseImageTopic("x".repeat(161)).ok, false);
    assert.equal(parseImageTopic(42).ok, false);
  });

  it("validates the vision description", () => {
    assert.equal(parseImageDescription({ description: "too short", keyItems: [] }), null);
    const parsed = parseImageDescription({
      description: "A busy café with people drinking coffee near a rainy window.",
      keyItems: ["café", 7, "window"],
    });
    assert.deepEqual(parsed?.keyItems, ["café", "window"]);
  });

  it("requires image context for the image-talk scenario", () => {
    const base = { level: "beginner", topic: "image-talk", messages: [], knownWords: [] };
    assert.equal(parseChatRequest(base).ok, false);
    const ok = parseChatRequest({
      ...base,
      imageContext: { topic: "A café", description: "A busy café with people drinking coffee.", keyItems: ["coffee"] },
    });
    assert.ok(ok.ok);
    assert.equal(ok.value.imageContext?.topic, "A café");
  });
});

describe("image prompt", () => {
  it("tells the model it knows the image only from the description", () => {
    const prompt = buildSystemPrompt("beginner", "image-talk", true, [], {
      topic: "A café",
      description: "A busy café with a red bus outside.",
      keyItems: [],
    });
    assert.match(prompt, /cannot see it/);
    assert.match(prompt, /red bus/);
  });
});

describe("detectAudioMime", () => {
  it("recognises MP3, WAV and OGG and rejects JSON error bodies", async () => {
    const { detectAudioMime } = await import("../lib/audioMime.ts");
    assert.equal(detectAudioMime(new Uint8Array([0x49, 0x44, 0x33, 0x04])), "audio/mpeg");
    assert.equal(detectAudioMime(new Uint8Array([0xff, 0xfb, 0x90, 0x00])), "audio/mpeg");
    assert.equal(
      detectAudioMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
      "audio/wav",
    );
    assert.equal(detectAudioMime(new TextEncoder().encode("OggS....")), "audio/ogg");
    assert.equal(detectAudioMime(new TextEncoder().encode('{"error":{"message":"x"}}')), null);
  });
});

describe("prompt guards found by the quality run", () => {
  it("tells the model not to confirm details missing from the image description", () => {
    const prompt = buildSystemPrompt("beginner", "image-talk", false, [], {
      topic: "A café",
      description: "A busy café with a red bus outside.",
      keyItems: [],
    });
    assert.match(prompt, /can't see it in the picture/);
    assert.match(prompt, /never add colours, numbers, genders/);
  });

  it("forbids A1 vocabulary and cosmetic corrections for beginners", () => {
    const prompt = buildSystemPrompt("beginner", "restaurant", false);
    assert.match(prompt, /NEVER A1 basics/);
    assert.match(prompt, /cafe\/café/);
  });
});
