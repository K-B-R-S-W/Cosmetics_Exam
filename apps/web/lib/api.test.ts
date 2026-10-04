import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { AdminAuthError } from "./auth";
import { ApiError, apiErrorResponse, validationError } from "./api";
import { OriginCheckError } from "./origin";

describe("API errors", () => {
  it("keeps the standard JSON shape for route errors", async () => {
    const response = new ApiError("not_found", 404, "Not found.").toResponse();

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Not found.", details: null },
    });
  });

  it("reuses auth and origin error responses", async () => {
    const auth = apiErrorResponse(
      new AdminAuthError("unauthenticated", 401),
      "/test",
    );
    const origin = apiErrorResponse(new OriginCheckError(), "/test");

    expect(auth.status).toBe(401);
    expect(origin.status).toBe(403);
    expect((await auth.json()).error.code).toBe("unauthenticated");
    expect((await origin.json()).error.code).toBe("forbidden");
  });

  it("returns only paths and messages for zod failures", () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    expect(result.success).toBe(false);

    if (!result.success) {
      expect(validationError(result.error).details).toEqual([
        { path: "name", message: "Too small: expected string to have >=1 characters" },
      ]);
    }
  });
});
