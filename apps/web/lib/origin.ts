const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const FORBIDDEN_RESPONSE_BODY = {
  error: {
    code: "forbidden",
    message: "You don't have permission to do that.",
    details: null,
  },
} as const;

export class OriginCheckError extends Error {
  readonly code = "forbidden";
  readonly status = 403;

  constructor() {
    super(FORBIDDEN_RESPONSE_BODY.error.message);
    this.name = "OriginCheckError";
  }

  toResponse(): Response {
    return Response.json(FORBIDDEN_RESPONSE_BODY, {
      status: this.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();

  for (const value of (process.env.ALLOWED_ORIGINS ?? "").split(",")) {
    const candidate = value.trim();

    if (!candidate) {
      continue;
    }

    try {
      const parsed = new URL(candidate);

      if (
        parsed.pathname === "/" &&
        !parsed.search &&
        !parsed.hash &&
        !parsed.username &&
        !parsed.password
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Invalid configuration never expands the allowlist.
    }
  }

  return origins;
}

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    if (request.headers.get("sec-fetch-site") === "same-origin") {
      return;
    }

    throw new OriginCheckError();
  }

  let suppliedOrigin: string;

  try {
    const parsed = new URL(originHeader);

    if (parsed.origin !== originHeader || parsed.pathname !== "/") {
      throw new Error("non-canonical-origin");
    }

    suppliedOrigin = parsed.origin;
  } catch {
    throw new OriginCheckError();
  }

  const requestOrigin = new URL(request.url).origin;

  if (
    suppliedOrigin !== requestOrigin &&
    !configuredOrigins().has(suppliedOrigin)
  ) {
    throw new OriginCheckError();
  }
}
