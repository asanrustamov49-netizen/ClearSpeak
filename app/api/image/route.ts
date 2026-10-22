import { connection } from "next/server";

import { errorResponse, handleRouteError, jsonResponse, readJsonBody } from "@/lib/http";
import { generateImage, getImageStatus } from "@/lib/omniroute";
import { isRecord, parseImageTopic } from "@/lib/validation";

/** Which image features are configured. Never exposes model names or keys. */
export async function GET(): Promise<Response> {
  // Read env at request time, not at build time.
  await connection();
  return jsonResponse(getImageStatus());
}

/** Generates an image and returns the validated image bytes with the detected MIME type. */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const topic = parseImageTopic(isRecord(body.value) ? body.value.topic : undefined);
  if (!topic.ok) return errorResponse(400, "invalid_request", topic.message);

  try {
    const image = await generateImage(topic.value, request.signal);
    return new Response(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.mime }), {
      headers: { "Content-Type": image.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return handleRouteError(error, "api/image");
  }
}
