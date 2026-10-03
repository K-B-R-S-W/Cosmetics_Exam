import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

describe("updateSupabaseSession", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-key";
    mocks.createServerClient.mockReset();
    mocks.getClaims.mockReset().mockResolvedValue({
      data: { claims: { sub: "admin-1" } },
      error: null,
    });
    mocks.createServerClient.mockReturnValue({
      auth: { getClaims: mocks.getClaims },
    });
  });

  it("verifies claims and prevents caching", async () => {
    const { updateSupabaseSession } = await import("@/lib/supabase/proxy");
    const response = await updateSupabaseSession(
      new NextRequest("http://localhost:3000/admin"),
    );

    expect(mocks.getClaims).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("copies refreshed cookies and cache headers to the response", async () => {
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getClaims: vi.fn(async () => {
          options.cookies.setAll(
            [{ name: "sb-session", value: "refreshed", options: { path: "/" } }],
            { "Cache-Control": "private, no-store", Pragma: "no-cache" },
          );
          return { data: { claims: {} }, error: null };
        }),
      },
    }));
    const { updateSupabaseSession } = await import("@/lib/supabase/proxy");
    const response = await updateSupabaseSession(
      new NextRequest("http://localhost:3000/admin"),
    );

    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
