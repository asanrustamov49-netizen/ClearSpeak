import { handleRouteError, jsonResponse, errorResponse, readJsonBody } from "@/lib/http";
import { requestHints } from "@/lib/omniroute";
import { parseHintsRequest } from "@/lib/validation";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseHintsRequest(body.value);
  if (!parsed.ok) return errorResponse(400, "invalid_request", parsed.message);

  try {
    return jsonResponse(await requestHints(parsed.value, request.signal));
  } catch (error) {
    return handleRouteError(error, "api/hints");
  }
}
