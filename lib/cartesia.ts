import "server-only";
import { UpstreamError } from "./http";

const CARTESIA_VERSION = "2026-08-14";
const DEFAULT_BASE_URL = "https://api.cartesia.ai";
const DEFAULT_MODEL_ID = "sonic-3";
const ALLOWED_MODELS = ["sonic-3.6", "sonic-3.5", "sonic-3", "sonic-latest"] as const;
const REQUEST_TIMEOUT_MS = 20_000;

interface CartesiaConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  voiceId: string | null;
}

function readConfig(): CartesiaConfig | null {
  const apiKey = process.env.CARTESIA_API_KEY?.trim() ?? "";
  if (!apiKey) return null;
  const baseUrl = (process.env.CARTESIA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const requestedModel = process.env.CARTESIA_MODEL_ID?.trim() ?? "";
  const modelId = (ALLOWED_MODELS as readonly string[]).includes(requestedModel) ? requestedModel : DEFAULT_MODEL_ID;
  const voiceId = process.env.CARTESIA_VOICE_ID?.trim() || null;
  return { baseUrl, apiKey, modelId, voiceId };
}

export function isCartesiaConfigured(): boolean {
  return readConfig() !== null;
}

function headers(config: CartesiaConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    "Cartesia-Version": CARTESIA_VERSION,
    "Content-Type": "application/json",
  };
}

function errorForStatus(status: number): UpstreamError {
  if (status === 401 || status === 403) {
    return new UpstreamError("upstream_auth", 502, "Cartesia отклонила запрос: проверьте CARTESIA_API_KEY.");
  }
  if (status === 402) {
    return new UpstreamError("upstream_rate_limited", 429, "На аккаунте Cartesia закончились кредиты.");
  }
  if (status === 429) {
    return new UpstreamError("upstream_rate_limited", 429, "Превышен лимит запросов Cartesia. Попробуйте чуть позже.");
  }
  if (status === 400 || status === 404 || status === 422) {
    return new UpstreamError("upstream_model", 502, "Cartesia не приняла параметры: проверьте CARTESIA_VOICE_ID и CARTESIA_MODEL_ID.");
  }
  return new UpstreamError("upstream_error", 503, "Сервис озвучивания Cartesia сейчас недоступен.");
}

async function cartesiaFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new UpstreamError("timeout", 504, "Cartesia отвечает слишком долго.");
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new UpstreamError("upstream_unreachable", 503, "Не удалось подключиться к Cartesia.");
  }
}

let cachedDefaultVoice: string | null = null;

async function resolveVoiceId(config: CartesiaConfig, signal: AbortSignal): Promise<string> {
  if (config.voiceId) return config.voiceId;
  if (cachedDefaultVoice) return cachedDefaultVoice;

  const response = await cartesiaFetch(`${config.baseUrl}/voices?language=en&limit=10`, { headers: headers(config) }, signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    console.error(`[cartesia] voices lookup failed with HTTP ${response.status}`);
    throw errorForStatus(response.status);
  }
  const payload: unknown = await response.json().catch(() => null);
  const data =
    typeof payload === "object" && payload !== null && "data" in payload && Array.isArray((payload as { data: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : [];
  const first = data.find(
    (voice): voice is { id: string } =>
      typeof voice === "object" && voice !== null && typeof (voice as { id?: unknown }).id === "string",
  );
  if (!first) throw new UpstreamError("upstream_model", 502, "Cartesia не вернула ни одного английского голоса. Задайте CARTESIA_VOICE_ID.");
  cachedDefaultVoice = first.id;
  return first.id;
}

export interface SynthesizedAudio {
  bytes: ArrayBuffer;
  contentType: string;
}

export async function synthesizeSpeech(text: string, signal: AbortSignal): Promise<SynthesizedAudio> {
  const config = readConfig();
  if (!config) throw new UpstreamError("not_configured", 503, "Cartesia не настроена: задайте CARTESIA_API_KEY.");

  const voiceId = await resolveVoiceId(config, signal);
  const response = await cartesiaFetch(
    `${config.baseUrl}/tts/bytes`,
    {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        model_id: config.modelId,
        transcript: text,
        voice: { id: voiceId },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
        language: "en",
      }),
    },
    signal,
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    console.error(`[cartesia] tts failed with HTTP ${response.status}`);
    throw errorForStatus(response.status);
  }

  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  if (!contentType.startsWith("audio/")) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError("upstream_error", 502, "Cartesia вернула неожиданный ответ вместо аудио.");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new UpstreamError("upstream_error", 502, "Cartesia вернула пустое аудио.");
  return { bytes, contentType };
}
