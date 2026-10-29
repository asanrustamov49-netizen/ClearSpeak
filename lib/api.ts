import { getScenario } from "./constants";
import { detectImageMime } from "./imageMime";
import type {
  ApiErrorCode,
  ChatRequestBody,
  ChatStreamEvent,
  ImageContext,
  ImageStatus,
  CoachReply,
  HintsRequestBody,
  HintsResult,
  SessionSummary,
  SummaryRequestBody,
  TranslateRequestBody,
  TranslationResult,
  TtsStatus,
} from "./types";
import {
  isRecord,
  parseCoachReply,
  parseHintsResult,
  parseImageDescription,
  parseSessionSummary,
  parseTranslationResult,
} from "./validation";

export class ChatApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ChatApiError";
    this.code = code;
  }
}

function readErrorBody(value: unknown): { code: ApiErrorCode; message: string } | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = (value as { error: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code: code as ApiErrorCode, message };
}

async function send(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ChatApiError("network", "Нет соединения с сервером. Проверьте интернет и повторите.");
  }
}

async function throwForResponse(response: Response): Promise<never> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = readErrorBody(payload);
  throw new ChatApiError(parsed?.code ?? "internal", parsed?.message ?? `Сервер вернул ошибку ${response.status}.`);
}

async function postJson<T>(url: string, body: unknown, parse: (value: unknown) => T | null, signal?: AbortSignal): Promise<T> {
  const response = await send(url, body, signal);
  if (!response.ok) return throwForResponse(response);
  const payload: unknown = await response.json().catch(() => null);
  const result = parse(payload);
  if (!result) throw new ChatApiError("invalid_model_output", "Сервер вернул ответ в неожиданном формате.");
  return result;
}

function parseStreamEvent(line: string): ChatStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.type === "delta" && typeof value.reply === "string") return { type: "delta", reply: value.reply };
  if (value.type === "reset") return { type: "reset" };
  if (value.type === "final") return { type: "final", data: value.data as CoachReply };
  if (value.type === "error") {
    const parsed = readErrorBody(value);
    return parsed ? { type: "error", error: parsed } : null;
  }
  return null;
}

export async function postChatStream(
  body: ChatRequestBody,
  signal: AbortSignal,
  onDelta: (text: string | null) => void,
): Promise<CoachReply> {
  const response = await send("/api/chat", body, signal);
  if (!response.ok) return throwForResponse(response);
  const reader = response.body?.getReader();
  if (!reader) throw new ChatApiError("network", "Сервер не вернул ответ.");

  const decoder = new TextDecoder();
  let buffer = "";
  const isOpening = body.messages.length === 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const event = parseStreamEvent(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (!event) continue;
        if (event.type === "delta") onDelta(event.reply);
        else if (event.type === "reset") onDelta(null);
        else if (event.type === "error") throw new ChatApiError(event.error.code, event.error.message);
        else {
          const reply = parseCoachReply(event.data, { isOpening });
          if (!reply) throw new ChatApiError("invalid_model_output", "Сервер вернул ответ в неожиданном формате.");
          return reply;
        }
      }
    }
  } catch (error) {
    if (error instanceof ChatApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ChatApiError("network", "Соединение прервалось во время ответа. Повторите попытку.");
  } finally {
    reader.cancel().catch(() => undefined);
  }
  throw new ChatApiError("network", "Ответ прервался. Повторите попытку.");
}

export async function fetchImageStatus(): Promise<ImageStatus> {
  try {
    const response = await fetch("/api/image", { cache: "no-store" });
    const value: unknown = await response.json();
    if (response.ok && isRecord(value)) return { generation: value.generation === true, vision: value.vision === true };
  } catch {
  }
  return { generation: false, vision: false };
}

export async function postGenerateImage(topic: string, signal: AbortSignal): Promise<Blob> {
  const response = await send("/api/image", { topic }, signal);
  if (!response.ok) return throwForResponse(response);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const mime = detectImageMime(buffer);
  if (!mime) throw new ChatApiError("invalid_model_output", "Сервер вернул данные, которые не являются изображением.");
  return new Blob([buffer], { type: mime });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export async function postDescribeImage(topic: string, image: Blob, signal: AbortSignal): Promise<ImageContext> {
  const imageBase64 = await blobToBase64(image);
  const result = await postJson("/api/image/describe", { topic, imageBase64 }, parseImageDescription, signal);
  return { topic, description: result.description, keyItems: result.keyItems };
}

export function postHints(body: HintsRequestBody, signal?: AbortSignal): Promise<HintsResult> {
  return postJson("/api/hints", body, parseHintsResult, signal);
}

export function postTranslate(body: TranslateRequestBody, signal?: AbortSignal): Promise<TranslationResult> {
  return postJson("/api/translate", body, (value) => parseTranslationResult(value, body.phrase), signal);
}

export function postSummary(body: SummaryRequestBody, signal?: AbortSignal): Promise<SessionSummary> {
  const hasGoal = getScenario(body.topic).successCriteria !== null;
  return postJson("/api/summary", body, (value) => parseSessionSummary(value, { messages: body.messages, hasGoal }), signal);
}

export async function fetchTtsStatus(): Promise<TtsStatus> {
  try {
    const response = await fetch("/api/tts", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (
      response.ok &&
      isRecord(payload) &&
      (payload.provider === "cartesia" || payload.provider === "omniroute") &&
      typeof payload.label === "string"
    ) {
      return { provider: payload.provider, label: payload.label.slice(0, 60) };
    }
  } catch {
  }
  return { provider: "browser", label: "Голос браузера" };
}

export async function fetchTtsAudio(text: string, signal?: AbortSignal): Promise<Blob> {
  const response = await send("/api/tts", { text }, signal);
  if (!response.ok) return throwForResponse(response);
  const blob = await response.blob();
  if (!blob.type.startsWith("audio/") || blob.size === 0) {
    throw new ChatApiError("upstream_error", "Сервис озвучивания вернул неожиданный ответ.");
  }
  return blob;
}
