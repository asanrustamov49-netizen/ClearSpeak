import { MAX_REQUEST_BYTES } from "./constants";
import type { ApiErrorBody, ApiErrorCode } from "./types";

export class UpstreamError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
  }
}

export function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readJsonBody(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Запрос слишком большой. Начните новую сессию.") };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_request", "Не удалось прочитать запрос.") };
  }
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Запрос слишком большой. Начните новую сессию.") };
  }

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_request", "Тело запроса должно быть корректным JSON.") };
  }
}

export function handleRouteError(error: unknown, scope: string): Response {
  if (error instanceof UpstreamError) return errorResponse(error.status, error.code, error.message);
  if (error instanceof DOMException && error.name === "AbortError") {
    return errorResponse(499, "network", "Запрос отменён.");
  }
  console.error(`[${scope}] unexpected error`, error instanceof Error ? error.name : typeof error);
  return errorResponse(500, "internal", "Внутренняя ошибка сервера. Повторите попытку.");
}

export function jsonResponse(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
