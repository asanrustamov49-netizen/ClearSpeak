import { MAX_IMAGE_BYTES } from "@/lib/constants";
import { errorResponse, handleRouteError, jsonResponse, readJsonBody } from "@/lib/http";
import { detectImageMime } from "@/lib/imageMime";
import { describeImage } from "@/lib/omniroute";
import { isRecord, parseImageTopic } from "@/lib/validation";

const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4096;

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  if (!isRecord(body.value)) return errorResponse(400, "invalid_request", "Тело запроса должно быть JSON-объектом.");

  const topic = parseImageTopic(body.value.topic);
  if (!topic.ok) return errorResponse(400, "invalid_request", topic.message);

  const base64 = typeof body.value.imageBase64 === "string" ? body.value.imageBase64 : "";
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return errorResponse(400, "invalid_request", "Нет данных изображения.");
  }
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  if (bytes.byteLength > MAX_IMAGE_BYTES) return errorResponse(413, "payload_too_large", "Изображение слишком большое.");
  const mime = detectImageMime(bytes);
  if (!mime) return errorResponse(400, "invalid_request", "Файл не является изображением PNG, JPEG, WebP или GIF.");

  try {
    return jsonResponse(await describeImage({ base64, mime }, topic.value, request.signal));
  } catch (error) {
    return handleRouteError(error, "api/image/describe");
  }
}
