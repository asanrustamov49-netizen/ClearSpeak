import { handleRouteError, jsonResponse, errorResponse, readJsonBody } from "@/lib/http";
import { requestSummary } from "@/lib/omniroute";
import { parseSummaryRequest } from "@/lib/validation";

export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = parseSummaryRequest(body.value);
  if (!parsed.ok) return errorResponse(400, "invalid_request", parsed.message);

  try {
    return jsonResponse(await requestSummary(parsed.value, request.signal));
  } catch (error) {
    return handleRouteError(error, "api/summary");
  }
}
