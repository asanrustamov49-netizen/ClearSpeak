import { connection } from "next/server";

import { isCartesiaConfigured, synthesizeSpeech } from "@/lib/cartesia";
import { MAX_TTS_CHARS } from "@/lib/constants";
import { errorResponse, handleRouteError, jsonResponse, readJsonBody } from "@/lib/http";
import { getOmniRouteTtsLabel, synthesizeSpeechViaOmniRoute } from "@/lib/omniroute";
import type { TtsStatus } from "@/lib/types";
import { isRecord } from "@/lib/validation";

/** Active server TTS: Cartesia (direct) first, then OmniRoute /audio/speech, otherwise the browser voice. */
function activeProvider(): TtsStatus {
  if (isCartesiaConfigured()) return { provider: "cartesia", label: "Cartesia" };
  const omni = getOmniRouteTtsLabel();
  if (omni) return { provider: "omniroute", label: omni };
  return { provider: "browser", label: "Голос браузера" };
}

/** Tells the client which TTS engine is active. Never exposes keys, voice ids or model names. */
export async function GET(): Promise<Response> {
  // Read env at request time, not at build time.
  await connection();
  return jsonResponse(activeProvider());
}

export async function POST(request: Request): Promise<Response> {
  const { provider } = activeProvider();
  if (provider === "browser") {
    return errorResponse(503, "not_configured", "Серверное озвучивание не настроено: используется голос браузера.");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const text = isRecord(body.value) && typeof body.value.text === "string" ? body.value.text.trim() : "";
  if (!text) return errorResponse(400, "invalid_request", "Нет текста для озвучивания.");
  if (text.length > MAX_TTS_CHARS) {
    return errorResponse(413, "payload_too_large", `Текст для озвучивания слишком длинный (максимум ${MAX_TTS_CHARS} символов).`);
  }

  try {
    if (provider === "cartesia") {
      const audio = await synthesizeSpeech(text, request.signal);
      return new Response(audio.bytes, { headers: { "Content-Type": audio.contentType, "Cache-Control": "no-store" } });
    }
    const audio = await synthesizeSpeechViaOmniRoute(text, request.signal);
    return new Response(new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: audio.mime }), {
      headers: { "Content-Type": audio.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return handleRouteError(error, "api/tts");
  }
}
