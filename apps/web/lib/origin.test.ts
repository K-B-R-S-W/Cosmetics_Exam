import { afterEach, describe, expect, it } from "vitest";

import {
  assertSameOrigin,
  FORBIDDEN_RESPONSE_BODY,
  OriginCheckError,
} from "@/lib/origin";

const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

function request(
  method: string,
  url: string,
  headers: Record<string, string> = {},
) {
  return new Request(url, { method, headers });
}

afterEach(() => {
  if (originalAllowedOrigins === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
  }
});

describe("assertSameOrigin", () => {
  it("accepts a matching origin", () => {
    expect(() =>
      assertSameOrigin(
        request("POST", "http://localhost:3000/api/admin/exams", {
          origin: "http://localhost:3000",
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a missing Origin only for a same-origin fetch", () => {
    expect(() =>
      assertSameOrigin(
        request("POST", "http://localhost:3000/api/admin/exams", {
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects a missing Origin without same-origin fetch metadata", () => {
    expect(() =>
      assertSameOrigin(
        request("POST", "http://localhost:3000/api/admin/exams"),
      ),
    ).toThrowError(OriginCheckError);
  });

  it("rejects a malformed Origin with the standard 403 response", async () => {
    try {
      assertSameOrigin(
        request("PATCH", "http://localhost:3000/api/admin/exams/1", {
          origin: "not a URL",
        }),
      );
      expect.unreachable("Expected an origin failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "forbidden", status: 403 });
      const response = (error as OriginCheckError).toResponse();
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: {
          code: "forbidden",
          message: "You don't have permission to do that.",
          details: null,
        },
      });
      expect(FORBIDDEN_RESPONSE_BODY.error.code).toBe("forbidden");
    }
  });

  it("rejects a mismatched origin", () => {
    expect(() =>
      assertSameOrigin(
        request("DELETE", "https://exam.example/api/admin/exams/1", {
          origin: "https://attacker.example",
        }),
      ),
    ).toThrowError(OriginCheckError);
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "does not check safe method %s",
    (method) => {
      expect(() =>
        assertSameOrigin(
          request(method, "https://exam.example/api/admin/exams", {
            origin: "malformed",
          }),
        ),
      ).not.toThrow();
    },
  );

  it("does not treat localhost and 127.0.0.1 as the same origin", () => {
    expect(() =>
      assertSameOrigin(
        request("POST", "http://127.0.0.1:3000/api/admin/exams", {
          origin: "http://localhost:3000",
        }),
      ),
    ).toThrowError(OriginCheckError);
  });

  it("accepts an explicitly configured additional origin", () => {
    process.env.ALLOWED_ORIGINS =
      "https://preview.example, http://localhost:3000/";

    expect(() =>
      assertSameOrigin(
        request("POST", "https://exam.example/api/admin/exams", {
          origin: "https://preview.example",
        }),
      ),
    ).not.toThrow();
  });
});
