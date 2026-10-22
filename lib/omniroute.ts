import "server-only";

import { CHAT_CONTEXT_MESSAGES, getScenario, MAX_IMAGE_BYTES } from "./constants";
import { UpstreamError as OmniRouteError } from "./http";
import { detectAudioMime, type AudioMime } from "./audioMime";
import { detectImageMime, type ImageMime } from "./imageMime";
import { readStreamingStringField } from "./partialJson";
import {
  buildHintsPrompt,
  buildImagePrompt,
  buildSummaryPrompt,
  buildSystemPrompt,
  buildTranslatePrompt,
  COACH_REPLY_SCHEMA,
  HINTS_SCHEMA,
  IMAGE_DESCRIPTION_SCHEMA,
  SUMMARY_SCHEMA,
  TRANSLATION_SCHEMA,
  VISION_SYSTEM_PROMPT,
} from "./prompt";
import type {
  ChatRequestBody,
  ChatTurn,
  CoachReply,
  HintsRequestBody,
  HintsResult,
  ImageStatus,
  SessionSummary,
  SummaryRequestBody,
  TranslateRequestBody,
  TranslationResult,
} from "./types";
import {
  isRecord,
  parseCoachReply,
  parseHintsResult,
  parseImageDescription,
  parseSessionSummary,
  parseTranslationResult,
} from "./validation";

/** Separate time budgets: text replies should be quick, image generation legitimately takes long. */
const TEXT_TIMEOUT_MS = 45_000;
/** A stream that stays silent this long is treated as stalled (seen in practice with grok-cli). */
const STREAM_IDLE_TIMEOUT_MS = 20_000;
const VISION_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 120_000;
const TTS_TIMEOUT_MS = 20_000;
const MAX_TTS_AUDIO_BYTES = 5 * 1024 * 1024;
/** Extra attempts only when the model returns output that fails validation. HTTP errors are never retried. */
const INVALID_OUTPUT_RETRIES = 1;

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

interface OmniRouteConfig {
  baseUrl: string;
  apiKey: string;
  /** Main conversational model (OMNIROUTE_MODEL). */
  model: string;
  /** Cheap/fast model for translations and hints; falls back to the main model. */
  fastModel: string;
  /** Optional verified backup for the main model on timeouts/5xx. */
  fallbackModel: string | null;
  visionModel: string | null;
  imageModel: string | null;
  /** Speech model for POST /audio/speech, e.g. elevenlabs/eleven_turbo_v2_5. */
  ttsModel: string | null;
  ttsVoice: string | null;
  /** Sent as `reasoning_effort` when set; reasoning tokens were the main source of latency. */
  reasoningEffort: ReasoningEffort | null;
}

function readConfig(): OmniRouteConfig {
  const env = (name: string) => process.env[name]?.trim() ?? "";
  const baseUrl = env("OMNIROUTE_BASE_URL");
  const model = env("OMNIROUTE_MODEL");

  if (!baseUrl || !model) {
    throw new OmniRouteError(
      "not_configured",
      503,
      "OmniRoute не настроен: задайте OMNIROUTE_BASE_URL и OMNIROUTE_MODEL в .env.local и перезапустите сервер.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new OmniRouteError("not_configured", 503, "OMNIROUTE_BASE_URL должен быть корректным URL (например http://localhost:20128/v1).");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OmniRouteError("not_configured", 503, "OMNIROUTE_BASE_URL должен использовать http или https.");
  }

  const effort = env("OMNIROUTE_REASONING_EFFORT").toLowerCase();
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: env("OMNIROUTE_API_KEY"),
    model,
    fastModel: env("OMNIROUTE_FAST_MODEL") || model,
    fallbackModel: env("OMNIROUTE_FALLBACK_MODEL") || null,
    visionModel: env("OMNIROUTE_VISION_MODEL") || null,
    imageModel: env("OMNIROUTE_IMAGE_MODEL") || null,
    ttsModel: env("OMNIROUTE_TTS_MODEL") || null,
    ttsVoice: env("OMNIROUTE_TTS_VOICE") || null,
    reasoningEffort: (REASONING_EFFORTS as readonly string[]).includes(effort) ? (effort as ReasoningEffort) : null,
  };
}

/** Name of the OmniRoute TTS engine for the UI, or null when not configured. */
export function getOmniRouteTtsLabel(): string | null {
  try {
    const { ttsModel } = readConfig();
    if (!ttsModel) return null;
    return ttsModel.startsWith("elevenlabs/") ? "ElevenLabs через OmniRoute" : "TTS через OmniRoute";
  } catch {
    return null;
  }
}

/**
 * Text-to-speech through OmniRoute's OpenAI-compatible POST /audio/speech.
 * Verified with elevenlabs/eleven_turbo_v2_5 + a default ElevenLabs voice id (library voices return 402 on free plans).
 */
export async function synthesizeSpeechViaOmniRoute(text: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: AudioMime }> {
  const config = readConfig();
  if (!config.ttsModel) throw new OmniRouteError("not_configured", 503, "TTS через OmniRoute не настроен: задайте OMNIROUTE_TTS_MODEL.");
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: headers(config),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TTS_TIMEOUT_MS)]),
      cache: "no-store",
      body: JSON.stringify({
        model: config.ttsModel,
        input: text,
        ...(config.ttsVoice ? { voice: config.ttsVoice } : {}),
        response_format: "mp3",
      }),
    });
  } catch (error) {
    throw networkError(error, "Озвучивание готовится слишком долго.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    console.error(`[omniroute] tts model=${config.ttsModel}: HTTP ${response.status}`);
    throw errorForStatus(response.status, "OMNIROUTE_TTS_MODEL / OMNIROUTE_TTS_VOICE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TTS_AUDIO_BYTES) {
    throw new OmniRouteError("invalid_model_output", 502, "Сервис озвучивания вернул пустое или слишком большое аудио.");
  }
  const mime = detectAudioMime(bytes);
  if (!mime) throw new OmniRouteError("invalid_model_output", 502, "Сервис озвучивания вернул данные, которые не являются аудио.");
  console.info(`[omniroute] tts model=${config.ttsModel} total=${Math.round(performance.now() - started)}ms bytes=${bytes.byteLength}`);
  return { bytes, mime };
}

export function getImageStatus(): ImageStatus {
  try {
    const config = readConfig();
    return { generation: config.imageModel !== null, vision: config.visionModel !== null };
  } catch {
    return { generation: false, vision: false };
  }
}

function errorForStatus(status: number, what = "OMNIROUTE_MODEL"): OmniRouteError {
  if (status === 401 || status === 403) {
    // OmniRoute also answers 401/403 when the provider has no credentials or its key hit a limit.
    return new OmniRouteError(
      "upstream_auth",
      502,
      `OmniRoute отклонил запрос: проверьте OMNIROUTE_API_KEY и что для модели из ${what} подключён рабочий провайдер.`,
    );
  }
  if (status === 402) {
    return new OmniRouteError("upstream_rate_limited", 429, "У провайдера модели закончились средства или кредиты.");
  }
  if (status === 404) {
    return new OmniRouteError("upstream_model", 502, `OmniRoute не нашёл endpoint или модель: проверьте ${what}.`);
  }
  if (status === 429) {
    return new OmniRouteError("upstream_rate_limited", 429, "Превышен лимит запросов к модели. Подождите немного и повторите.");
  }
  if (status === 400 || status === 422) {
    return new OmniRouteError("upstream_model", 502, `Модель отклонила запрос. Проверьте, что модель из ${what} поддерживает этот тип запроса.`);
  }
  return new OmniRouteError("upstream_error", 503, "Модель сейчас недоступна. Повторите попытку позже.");
}

function headers(config: OmniRouteConfig): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) result.Authorization = `Bearer ${config.apiKey}`;
  return result;
}

function networkError(error: unknown, timeoutMessage = "Модель отвечает слишком долго. Повторите попытку."): unknown {
  if (error instanceof DOMException && error.name === "TimeoutError") return new OmniRouteError("timeout", 504, timeoutMessage);
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (error instanceof OmniRouteError) return error;
  return new OmniRouteError(
    "upstream_unreachable",
    503,
    "Не удалось подключиться к OmniRoute. Убедитесь, что он запущен и OMNIROUTE_BASE_URL указан верно.",
  );
}

/** Extracts `choices[0].message.content` from an OpenAI-compatible completion. */
function readCompletionContent(payload: unknown): { content: string | null; finishReason: string | null } {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return { content: null, finishReason: null };
  }
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return { content: null, finishReason: null };
  const content = typeof choice.message.content === "string" ? choice.message.content : null;
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;
  return { content, finishReason };
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface OutgoingMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface StructuredCall<T> {
  schemaName: string;
  schema: unknown;
  system: string;
  messages: OutgoingMessage[];
  temperature: number;
  model: string;
  timeoutMs: number;
  /** Validates the parsed JSON; returns null when it does not satisfy the contract. */
  parse: (value: unknown) => T | null;
}

function requestBody<T>(config: OmniRouteConfig, call: StructuredCall<T>, stream: boolean): string {
  return JSON.stringify({
    model: call.model,
    messages: [{ role: "system", content: call.system }, ...call.messages],
    stream,
    temperature: call.temperature,
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    response_format: { type: "json_schema", json_schema: { name: call.schemaName, strict: true, schema: call.schema } },
  });
}

function parseContent<T>(call: StructuredCall<T>, content: string | null, finishReason: string | null): T | null {
  if (!content || finishReason === "length") {
    console.error(`[omniroute] ${call.schemaName}: empty or truncated completion (finish_reason=${finishReason ?? "none"})`);
    return null;
  }
  let structured: unknown;
  try {
    structured = JSON.parse(content);
  } catch {
    console.error(`[omniroute] ${call.schemaName}: model content is not valid JSON`);
    return null;
  }
  const result = call.parse(structured);
  if (!result) console.error(`[omniroute] ${call.schemaName}: model output failed schema validation`);
  return result;
}

async function callOnce<T>(config: OmniRouteConfig, call: StructuredCall<T>, signal: AbortSignal): Promise<T | null> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(config),
      signal: AbortSignal.any([signal, AbortSignal.timeout(call.timeoutMs)]),
      cache: "no-store",
      body: requestBody(config, call, false),
    });
  } catch (error) {
    throw networkError(error);
  }

  if (!response.ok) {
    // Drain the body without exposing upstream details to the client.
    await response.body?.cancel().catch(() => undefined);
    console.error(`[omniroute] ${call.schemaName} model=${call.model}: HTTP ${response.status}`);
    throw errorForStatus(response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    const mapped = networkError(error);
    if (mapped instanceof OmniRouteError && mapped.code === "timeout") throw mapped;
    console.error(`[omniroute] ${call.schemaName}: response is not valid JSON`);
    return null;
  }
  console.info(`[omniroute] ${call.schemaName} model=${call.model} total=${Math.round(performance.now() - started)}ms`);
  const { content, finishReason } = readCompletionContent(payload);
  return parseContent(call, content, finishReason);
}

/** Errors where another model could help. Auth, quota and bad-request errors are not retried. */
function isFallbackable(error: unknown): boolean {
  return error instanceof OmniRouteError && (error.code === "timeout" || error.code === "upstream_error");
}

/** Calls OmniRoute with a JSON schema and returns the validated result, retrying once on invalid output. */
async function requestStructured<T>(call: StructuredCall<T>, signal: AbortSignal, config = readConfig()): Promise<T> {
  try {
    for (let attempt = 0; attempt <= INVALID_OUTPUT_RETRIES; attempt += 1) {
      const result = await callOnce(config, call, signal);
      if (result) return result;
    }
  } catch (error) {
    if (call.model === config.model && config.fallbackModel && isFallbackable(error)) {
      console.warn(`[omniroute] ${call.schemaName}: main model failed (${(error as OmniRouteError).code}), using OMNIROUTE_FALLBACK_MODEL`);
      const result = await callOnce(config, { ...call, model: config.fallbackModel }, signal);
      if (result) return result;
    } else {
      throw error;
    }
  }
  throw new OmniRouteError(
    "invalid_model_output",
    502,
    "Модель вернула ответ в неожиданном формате. Повторите попытку или выберите другую модель.",
  );
}

/** Reads an OpenAI-compatible SSE stream, calling onContent with the accumulated content. */
async function readSseContent(
  response: Response,
  onContent: (content: string) => void,
): Promise<{ content: string; finishReason: string | null; firstChunkAt: number | null }> {
  const body = response.body;
  if (!body) return { content: "", finishReason: null, firstChunkAt: null };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let firstChunkAt: number | null = null;

  try {
    for (;;) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(
          () => reject(new OmniRouteError("timeout", 504, "Модель перестала отвечать. Повторите попытку.")),
          STREAM_IDLE_TIMEOUT_MS,
        );
      });
      const chunk = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(idleTimer));
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return { content, finishReason, firstChunkAt };
        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (!isRecord(event) || !Array.isArray(event.choices) || !isRecord(event.choices[0])) continue;
        const choice = event.choices[0];
        if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
        const delta = isRecord(choice.delta) && typeof choice.delta.content === "string" ? choice.delta.content : "";
        if (delta) {
          firstChunkAt ??= performance.now();
          content += delta;
          onContent(content);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return { content, finishReason, firstChunkAt };
}

export interface ChatStreamHandlers {
  /** Provisional reply text while it streams. */
  onReply: (text: string) => void;
  /** Streamed text was invalid and will be regenerated. */
  onReset: () => void;
}

function coachCall(body: ChatRequestBody, config: OmniRouteConfig): StructuredCall<CoachReply> {
  const isOpening = body.messages.length === 0;
  return {
    schemaName: "coach_reply",
    schema: COACH_REPLY_SCHEMA,
    system: buildSystemPrompt(body.level, body.topic, isOpening, body.knownWords, body.imageContext),
    // Only the recent part of the dialogue goes to the model: the scenario, level and image live in the system prompt.
    messages: isOpening
      ? [{ role: "user", content: "(The learner has just opened the session. Start the scene.)" }]
      : body.messages.slice(-CHAT_CONTEXT_MESSAGES),
    temperature: 0.7,
    model: config.model,
    timeoutMs: TEXT_TIMEOUT_MS,
    parse: (value) => parseCoachReply(value, { isOpening }),
  };
}

/**
 * Streams the coach reply: the `reply` field is surfaced as soon as it arrives, the full object is validated at the end.
 * Falls back to a regular request if streaming fails before any text, or if the streamed object is invalid.
 */
export async function streamCoachReply(body: ChatRequestBody, signal: AbortSignal, handlers: ChatStreamHandlers): Promise<CoachReply> {
  const config = readConfig();
  const call = coachCall(body, config);
  const started = performance.now();
  let sentText = false;

  try {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(config),
        signal: AbortSignal.any([signal, AbortSignal.timeout(TEXT_TIMEOUT_MS)]),
        cache: "no-store",
        body: requestBody(config, call, true),
      });
    } catch (error) {
      throw networkError(error);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      console.error(`[omniroute] coach_reply(stream) model=${call.model}: HTTP ${response.status}`);
      throw errorForStatus(response.status);
    }

    let lastReply = "";
    const { content, finishReason, firstChunkAt } = await readSseContent(response, (partial) => {
      const reply = readStreamingStringField(partial, "reply");
      if (reply && reply !== lastReply) {
        lastReply = reply;
        sentText = true;
        handlers.onReply(reply);
      }
    }).catch((error: unknown) => {
      throw networkError(error);
    });

    console.info(
      `[omniroute] coach_reply(stream) model=${call.model} first_text=${firstChunkAt ? Math.round(firstChunkAt - started) : "-"}ms total=${Math.round(performance.now() - started)}ms`,
    );
    const result = parseContent(call, content, finishReason);
    if (result) return result;
  } catch (error) {
    if (signal.aborted) throw error;
    // Errors that a retry will not fix (auth, quota, bad request) are surfaced immediately.
    if (!isFallbackable(error) && !(error instanceof OmniRouteError && error.code === "invalid_model_output")) throw error;
    console.warn(`[omniroute] coach_reply: stream failed (${error instanceof OmniRouteError ? error.code : "error"}), retrying without stream`);
  }

  if (sentText) handlers.onReset();
  return requestStructured(call, signal, config);
}

/** Non-streaming variant (used by tests and as a fallback). */
export function requestCoachReply(body: ChatRequestBody, signal: AbortSignal): Promise<CoachReply> {
  const config = readConfig();
  return requestStructured(coachCall(body, config), signal, config);
}

function transcript(messages: readonly ChatTurn[]): string {
  return messages.map((message) => `${message.role === "user" ? "LEARNER" : "AI"}: ${message.content}`).join("\n");
}

export function requestHints(body: HintsRequestBody, signal: AbortSignal): Promise<HintsResult> {
  const config = readConfig();
  return requestStructured(
    {
      schemaName: "reply_hints",
      schema: HINTS_SCHEMA,
      system: buildHintsPrompt(body.level, body.topic),
      messages: [{ role: "user", content: `Conversation so far:\n${transcript(body.messages.slice(-8))}` }],
      temperature: 0.8,
      model: config.fastModel,
      timeoutMs: TEXT_TIMEOUT_MS,
      parse: parseHintsResult,
    },
    signal,
    config,
  );
}

export function requestTranslation(body: TranslateRequestBody, signal: AbortSignal): Promise<TranslationResult> {
  const config = readConfig();
  return requestStructured(
    {
      schemaName: "translation",
      schema: TRANSLATION_SCHEMA,
      system: buildTranslatePrompt(body.level),
      messages: [{ role: "user", content: `Phrase: ${body.phrase}\nContext: ${body.context || "(none)"}` }],
      temperature: 0.2,
      model: config.fastModel,
      timeoutMs: TEXT_TIMEOUT_MS,
      parse: (value) => parseTranslationResult(value, body.phrase),
    },
    signal,
    config,
  );
}

export function requestSummary(body: SummaryRequestBody, signal: AbortSignal): Promise<SessionSummary> {
  const config = readConfig();
  const hasGoal = getScenario(body.topic).successCriteria !== null;
  return requestStructured(
    {
      schemaName: "session_summary",
      schema: SUMMARY_SCHEMA,
      system: buildSummaryPrompt(body.level, body.topic),
      messages: [{ role: "user", content: `Transcript:\n${transcript(body.messages)}` }],
      temperature: 0.3,
      model: config.model,
      timeoutMs: TEXT_TIMEOUT_MS,
      parse: (value) => parseSessionSummary(value, { messages: body.messages, hasGoal }),
    },
    signal,
    config,
  );
}

/** One-time vision description of the generated image; later chat turns only carry this text. */
export function describeImage(image: { base64: string; mime: ImageMime }, topic: string, signal: AbortSignal) {
  const config = readConfig();
  if (!config.visionModel) {
    throw new OmniRouteError("not_configured", 503, "Анализ изображений не настроен: задайте OMNIROUTE_VISION_MODEL.");
  }
  return requestStructured(
    {
      schemaName: "image_description",
      schema: IMAGE_DESCRIPTION_SCHEMA,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Describe this image. It was generated for the topic: ${topic}` },
            { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.base64}` } },
          ],
        },
      ],
      temperature: 0.2,
      model: config.visionModel,
      timeoutMs: VISION_TIMEOUT_MS,
      parse: parseImageDescription,
    },
    signal,
    config,
  );
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;

/** Downloads an image URL returned by the provider, trusting only public https URLs and real image bytes. */
async function downloadProviderImage(rawUrl: string, signal: AbortSignal): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OmniRouteError("invalid_model_output", 502, "Провайдер вернул некорректную ссылку на изображение.");
  }
  if (url.protocol !== "https:" || PRIVATE_HOST.test(url.hostname)) {
    throw new OmniRouteError("invalid_model_output", 502, "Провайдер вернул ссылку на изображение, которой нельзя доверять.");
  }
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: "error" }).catch(
    (error: unknown) => {
      throw networkError(error, "Изображение загружается слишком долго.");
    },
  );
  if (!response.ok) throw new OmniRouteError("upstream_error", 502, "Не удалось скачать изображение у провайдера.");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) throw new OmniRouteError("invalid_model_output", 502, "Изображение слишком большое.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new OmniRouteError("invalid_model_output", 502, "Изображение слишком большое.");
  return bytes;
}

/** Generates an image through OmniRoute's OpenAI-compatible POST /images/generations. */
export async function generateImage(topic: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: ImageMime }> {
  const config = readConfig();
  if (!config.imageModel) {
    throw new OmniRouteError("not_configured", 503, "Генерация изображений не настроена: задайте OMNIROUTE_IMAGE_MODEL.");
  }
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: headers(config),
      signal: AbortSignal.any([signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]),
      cache: "no-store",
      body: JSON.stringify({ model: config.imageModel, prompt: buildImagePrompt(topic), n: 1, size: "1024x1024" }),
    });
  } catch (error) {
    throw networkError(error, "Генерация изображения заняла слишком много времени. Попробуйте ещё раз.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    console.error(`[omniroute] image model=${config.imageModel}: HTTP ${response.status}`);
    throw errorForStatus(response.status, "OMNIROUTE_IMAGE_MODEL");
  }

  const payload: unknown = await response.json().catch(() => null);
  const first = isRecord(payload) && Array.isArray(payload.data) && isRecord(payload.data[0]) ? payload.data[0] : null;
  let bytes: Uint8Array | null = null;
  if (first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
    if (first.b64_json.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) {
      throw new OmniRouteError("invalid_model_output", 502, "Изображение слишком большое.");
    }
    bytes = new Uint8Array(Buffer.from(first.b64_json, "base64"));
  } else if (first && typeof first.url === "string") {
    bytes = await downloadProviderImage(first.url, signal);
  }
  if (!bytes || bytes.byteLength === 0) {
    throw new OmniRouteError("invalid_model_output", 502, "Провайдер не вернул изображение.");
  }
  const mime = detectImageMime(bytes);
  if (!mime) throw new OmniRouteError("invalid_model_output", 502, "Провайдер вернул данные, которые не являются изображением.");
  console.info(`[omniroute] image model=${config.imageModel} total=${Math.round(performance.now() - started)}ms bytes=${bytes.byteLength}`);
  return { bytes, mime };
}
