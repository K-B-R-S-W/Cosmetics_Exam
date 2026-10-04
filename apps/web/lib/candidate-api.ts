import { ApiError, apiErrorResponse } from "@/lib/api";
import { logger } from "@/lib/logger";

export interface CandidateRequestContext {
  requestId: string;
  setCandidateId(candidateId: string): void;
}

export async function readCandidateJson(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError("payload_too_large", 413, "The request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError("payload_too_large", 413, "The request is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("validation_failed", 400, "Send a valid JSON body.");
  }
}

export async function candidateRoute(
  route: string,
  handler: (context: CandidateRequestContext) => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  let candidateId: string | undefined;
  let response: Response;

  try {
    response = await handler({
      requestId,
      setCandidateId: (value) => {
        candidateId = value;
      },
    });
  } catch (error) {
    response = apiErrorResponse(error, route);
  }

  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-Id", requestId);
  logger.info("api_request", {
    requestId,
    route,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    actorId: candidateId,
  });
  return response;
}
