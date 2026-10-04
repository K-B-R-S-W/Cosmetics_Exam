import { ZodError } from "zod";

import { AdminAuthError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { OriginCheckError } from "@/lib/origin";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(): Response {
    return jsonResponse(
      {
        error: {
          code: this.code,
          message: this.message,
          details: this.details,
        },
      },
      { status: this.status },
    );
  }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");

  return Response.json(body, { ...init, headers });
}

export function validationError(error: ZodError): ApiError {
  return new ApiError(
    "validation_failed",
    400,
    "Check the highlighted fields and try again.",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

export function apiErrorResponse(error: unknown, route: string): Response {
  if (error instanceof AdminAuthError || error instanceof OriginCheckError) {
    return error.toResponse();
  }

  if (error instanceof ApiError) {
    return error.toResponse();
  }

  if (error instanceof ZodError) {
    return validationError(error).toResponse();
  }

  logger.error("api_request_failed", {
    route,
    status: 500,
    errorCode: "internal_error",
  });

  return new ApiError(
    "internal_error",
    500,
    "Something went wrong. Try again.",
  ).toResponse();
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("validation_failed", 400, "Send a valid JSON body.");
  }
}
