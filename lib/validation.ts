import {
  LEVEL_IDS,
  MAX_IMAGE_DESCRIPTION_CHARS,
  MAX_IMAGE_TOPIC_CHARS,
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_CONTEXT_CHARS,
  MAX_CORRECTIONS,
  MAX_HINTS,
  MAX_HISTORY_MESSAGES,
  MAX_KNOWN_WORDS,
  MAX_PHRASE_CHARS,
  MAX_USER_MESSAGE_CHARS,
  MAX_VOCABULARY,
  MAX_WORD_CHARS,
  TOPIC_IDS,
} from "./constants.ts";
import type {
  ChatRequestBody,
  ChatTurn,
  CoachReply,
  Correction,
  GoalStatus,
  HintsRequestBody,
  HintsResult,
  ImageContext,
  LevelId,
  ReplyHint,
  SessionSummary,
  SummaryError,
  SummaryRequestBody,
  TopicId,
  TranslateRequestBody,
  TranslationResult,
  VocabularyItem,
} from "./types";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLevel(value: unknown): value is LevelId {
  return typeof value === "string" && (LEVEL_IDS as readonly string[]).includes(value);
}

function isTopic(value: unknown): value is TopicId {
  return typeof value === "string" && (TOPIC_IDS as readonly string[]).includes(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Lowercases and collapses whitespace/punctuation so text can be compared loosely. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHistory(raw: unknown, options: { requireUserLast: boolean; allowEmpty: boolean }): ParseResult<ChatTurn[]> {
  if (!Array.isArray(raw)) return { ok: false, message: "Поле messages должно быть массивом." };
  if (raw.length > MAX_HISTORY_MESSAGES) {
    return { ok: false, message: `История слишком длинная (максимум ${MAX_HISTORY_MESSAGES} сообщений). Начните новую сессию.` };
  }
  if (!options.allowEmpty && raw.length === 0) return { ok: false, message: "История разговора пуста." };

  const messages: ChatTurn[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, message: "Некорректное сообщение в истории." };
    const { role, content } = item;
    if (role !== "user" && role !== "assistant") return { ok: false, message: "Некорректная роль сообщения." };
    if (typeof content !== "string") return { ok: false, message: "Текст сообщения должен быть строкой." };
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: "Сообщение не может быть пустым." };
    const limit = role === "user" ? MAX_USER_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS;
    if (trimmed.length > limit) return { ok: false, message: `Сообщение слишком длинное (максимум ${limit} символов).` };
    messages.push({ role, content: trimmed });
  }

  if (options.requireUserLast && messages.length > 0 && messages[messages.length - 1].role !== "user") {
    return { ok: false, message: "Последнее сообщение в истории должно быть от пользователя." };
  }
  return { ok: true, value: messages };
}

function parseKnownWords(raw: unknown): ParseResult<string[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "Поле knownWords должно быть массивом." };
  const words: string[] = [];
  for (const item of raw.slice(0, MAX_KNOWN_WORDS)) {
    const word = readString(item);
    if (word && word.length <= MAX_WORD_CHARS) words.push(word);
  }
  return { ok: true, value: words };
}

/** Image topic typed or picked by the learner: short plain text, no markup or control characters. */
export function parseImageTopic(raw: unknown): ParseResult<string> {
  const topic = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (topic.length < 3) return { ok: false, message: "Опишите тему изображения хотя бы в нескольких словах." };
  if (topic.length > MAX_IMAGE_TOPIC_CHARS) return { ok: false, message: `Тема слишком длинная (максимум ${MAX_IMAGE_TOPIC_CHARS} символов).` };
  if (/[<>{}\u0000-\u001f\u007f]/.test(topic)) return { ok: false, message: "Тема содержит недопустимые символы." };
  return { ok: true, value: topic };
}

function parseImageContextField(raw: unknown): ParseResult<ImageContext | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!isRecord(raw)) return { ok: false, message: "Некорректный контекст изображения." };
  const topic = parseImageTopic(raw.topic);
  if (!topic.ok) return topic;
  const description = readString(raw.description);
  if (!description || description.length > MAX_IMAGE_DESCRIPTION_CHARS) return { ok: false, message: "Некорректное описание изображения." };
  const keyItems = Array.isArray(raw.keyItems)
    ? raw.keyItems.map(readString).filter((item): item is string => item !== null && item.length <= MAX_WORD_CHARS).slice(0, 15)
    : [];
  return { ok: true, value: { topic: topic.value, description, keyItems } };
}

/** Validates the body of a POST /api/chat request. */
export function parseChatRequest(input: unknown): ParseResult<ChatRequestBody> {
  if (!isRecord(input)) return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  if (!isLevel(input.level)) return { ok: false, message: "Неизвестный уровень." };
  if (!isTopic(input.topic)) return { ok: false, message: "Неизвестный сценарий." };
  const history = parseHistory(input.messages, { requireUserLast: true, allowEmpty: true });
  if (!history.ok) return history;
  const knownWords = parseKnownWords(input.knownWords);
  if (!knownWords.ok) return knownWords;
  const image = parseImageContextField(input.imageContext);
  if (!image.ok) return image;
  if (input.topic === "image-talk" && !image.value) return { ok: false, message: "Для разговора об изображении нужно его описание." };
  return {
    ok: true,
    value: {
      level: input.level,
      topic: input.topic,
      messages: history.value,
      knownWords: knownWords.value,
      ...(image.value ? { imageContext: image.value } : {}),
    },
  };
}

/** Vision-model output: factual description of the generated image. */
export function parseImageDescription(input: unknown): { description: string; keyItems: string[] } | null {
  if (!isRecord(input)) return null;
  const description = readString(input.description);
  if (!description || description.length < 20) return null;
  const keyItems = Array.isArray(input.keyItems)
    ? input.keyItems.map(readString).filter((item): item is string => item !== null && item.length <= MAX_WORD_CHARS).slice(0, 15)
    : [];
  return { description: description.slice(0, MAX_IMAGE_DESCRIPTION_CHARS), keyItems };
}

/** Validates POST /api/hints. The last message must be the AI's line the learner needs to answer. */
export function parseHintsRequest(input: unknown): ParseResult<HintsRequestBody> {
  if (!isRecord(input)) return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  if (!isLevel(input.level)) return { ok: false, message: "Неизвестный уровень." };
  if (!isTopic(input.topic)) return { ok: false, message: "Неизвестный сценарий." };
  const history = parseHistory(input.messages, { requireUserLast: false, allowEmpty: false });
  if (!history.ok) return history;
  if (history.value[history.value.length - 1].role !== "assistant") {
    return { ok: false, message: "Подсказки доступны, когда последняя реплика — от ИИ." };
  }
  return { ok: true, value: { level: input.level, topic: input.topic, messages: history.value } };
}

/** Validates POST /api/summary. Requires at least one learner message. */
export function parseSummaryRequest(input: unknown): ParseResult<SummaryRequestBody> {
  if (!isRecord(input)) return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  if (!isLevel(input.level)) return { ok: false, message: "Неизвестный уровень." };
  if (!isTopic(input.topic)) return { ok: false, message: "Неизвестный сценарий." };
  const history = parseHistory(input.messages, { requireUserLast: false, allowEmpty: false });
  if (!history.ok) return history;
  if (!history.value.some((message) => message.role === "user")) {
    return { ok: false, message: "Для итогов нужна хотя бы одна ваша реплика." };
  }
  return { ok: true, value: { level: input.level, topic: input.topic, messages: history.value } };
}

/** Validates POST /api/translate. */
export function parseTranslateRequest(input: unknown): ParseResult<TranslateRequestBody> {
  if (!isRecord(input)) return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  if (!isLevel(input.level)) return { ok: false, message: "Неизвестный уровень." };
  const phrase = readString(input.phrase);
  if (!phrase || phrase.length > MAX_PHRASE_CHARS) return { ok: false, message: "Выберите слово или короткое выражение." };
  const context = typeof input.context === "string" ? input.context.trim().slice(0, MAX_CONTEXT_CHARS) : "";
  return { ok: true, value: { level: input.level, phrase, context } };
}

function parseCorrection(raw: unknown): Correction | null {
  if (!isRecord(raw)) return null;
  const original = readString(raw.original);
  const corrected = readString(raw.corrected);
  const explanation = readString(raw.explanation);
  if (!original || !corrected || !explanation) return null;
  // A "correction" that changes nothing is not a correction.
  if (original === corrected) return null;
  return { original, corrected, explanation };
}

function parseVocabularyItem(raw: unknown): VocabularyItem | null {
  if (!isRecord(raw)) return null;
  const word = readString(raw.word);
  const translation = readString(raw.translation);
  if (!word || !translation || word.length > MAX_WORD_CHARS) return null;
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  return { word, translation, note };
}

function parseHint(raw: unknown): ReplyHint | null {
  if (!isRecord(raw)) return null;
  const text = readString(raw.text);
  const translation = readString(raw.translation);
  if (!text || !translation || text.length > MAX_USER_MESSAGE_CHARS) return null;
  return { text, translation };
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Validates the structured chat object produced by the model.
 * Returns null when the required shape is wrong. Malformed individual items are dropped, never invented.
 * Vocabulary words must actually occur in the reply text.
 */
export function parseCoachReply(input: unknown, options: { isOpening: boolean }): CoachReply | null {
  if (!isRecord(input)) return null;
  const reply = readString(input.reply);
  if (!reply) return null;
  if (!Array.isArray(input.corrections) || !Array.isArray(input.vocabulary)) return null;

  const corrections = options.isOpening
    ? []
    : input.corrections
        .map(parseCorrection)
        .filter((item): item is Correction => item !== null)
        .slice(0, MAX_CORRECTIONS);

  const normalizedReply = normalizeForMatch(reply);
  const vocabulary = dedupeBy(
    input.vocabulary
      .map(parseVocabularyItem)
      .filter((item): item is VocabularyItem => item !== null)
      .filter((item) => normalizedReply.includes(normalizeForMatch(item.word))),
    (item) => normalizeForMatch(item.word),
  ).slice(0, MAX_VOCABULARY);

  const hints = Array.isArray(input.hints)
    ? input.hints
        .map(parseHint)
        .filter((item): item is ReplyHint => item !== null)
        .slice(0, MAX_HINTS)
    : [];

  const goalAchieved = input.goalAchieved === true;

  return { reply, corrections, vocabulary, hints, goalAchieved };
}

export function parseHintsResult(input: unknown): HintsResult | null {
  if (!isRecord(input) || !Array.isArray(input.hints)) return null;
  const hints = input.hints
    .map(parseHint)
    .filter((item): item is ReplyHint => item !== null)
    .slice(0, MAX_HINTS);
  return hints.length >= 2 ? { hints } : null;
}

export function parseTranslationResult(input: unknown, phrase: string): TranslationResult | null {
  if (!isRecord(input)) return null;
  const translation = readString(input.translation);
  if (!translation) return null;
  const note = typeof input.note === "string" ? input.note.trim() : "";
  return { phrase, translation, note };
}

const GOAL_STATUSES: readonly GoalStatus[] = ["completed", "partial", "not_completed", "not_applicable"];

/**
 * Validates the session summary against the actual dialogue:
 * error examples must be fragments the learner really wrote, words must really occur in the session.
 */
export function parseSessionSummary(
  input: unknown,
  context: { messages: ChatTurn[]; hasGoal: boolean },
): SessionSummary | null {
  if (!isRecord(input)) return null;
  if (!Array.isArray(input.topErrors) || !Array.isArray(input.newWords) || !isRecord(input.goal)) return null;
  const nextSessionTip = readString(input.nextSessionTip);
  if (!nextSessionTip) return null;

  const userText = normalizeForMatch(
    context.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join(" \n "),
  );
  const allText = normalizeForMatch(context.messages.map((message) => message.content).join(" \n "));

  const topErrors = input.topErrors
    .map((raw): SummaryError | null => {
      if (!isRecord(raw)) return null;
      const example = readString(raw.example);
      const corrected = readString(raw.corrected);
      const explanation = readString(raw.explanation);
      if (!example || !corrected || !explanation || example === corrected) return null;
      if (!userText.includes(normalizeForMatch(example))) return null;
      return { example, corrected, explanation };
    })
    .filter((item): item is SummaryError => item !== null)
    .slice(0, 3);

  const newWords = dedupeBy(
    input.newWords
      .map((raw) => {
        if (!isRecord(raw)) return null;
        const word = readString(raw.word);
        const translation = readString(raw.translation);
        if (!word || !translation || word.length > MAX_WORD_CHARS) return null;
        if (!allText.includes(normalizeForMatch(word))) return null;
        return { word, translation };
      })
      .filter((item): item is { word: string; translation: string } => item !== null),
    (item) => normalizeForMatch(item.word),
  ).slice(0, 20);

  const rawStatus = input.goal.status;
  let status: GoalStatus =
    typeof rawStatus === "string" && (GOAL_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as GoalStatus)
      : "not_completed";
  if (!context.hasGoal) status = "not_applicable";
  else if (status === "not_applicable") status = "not_completed";
  const comment = typeof input.goal.comment === "string" ? input.goal.comment.trim() : "";

  return { topErrors, newWords, nextSessionTip, goal: { status, comment } };
}
