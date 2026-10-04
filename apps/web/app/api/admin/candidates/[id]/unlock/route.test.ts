import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertSameOrigin: vi.fn(),
  candidate: vi.fn(),
  cutoff: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/origin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/origin")>()),
  assertSameOrigin: mocks.assertSameOrigin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "candidates") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: mocks.candidate })),
          })),
        };
      }
      if (table === "login_attempts") {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                gte: mocks.cutoff,
              })),
            })),
          })),
        };
      }
      return { insert: mocks.audit };
    }),
  })),
}));

describe("candidate unlock route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T06:30:00.000Z"));
    mocks.requireAdmin.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test Admin",
      role: "admin",
    });
    mocks.candidate.mockResolvedValue({
      data: {
        id: "00000000-0000-4000-8000-000000000002",
        mer_code: "TEST-001",
      },
      error: null,
    });
    mocks.cutoff.mockImplementation(() => ({
      select: vi.fn().mockResolvedValue({
        data: [{ id: 1 }, { id: 2 }],
        error: null,
      }),
    }));
    mocks.audit.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("clears only failed attempts from the last 10 minutes", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request(
        "http://localhost/api/admin/candidates/00000000-0000-4000-8000-000000000002/unlock",
        { method: "POST", headers: { Origin: "http://localhost" } },
      ),
      {
        params: Promise.resolve({
          id: "00000000-0000-4000-8000-000000000002",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cleared: 2 });
    expect(mocks.cutoff).toHaveBeenCalledWith(
      "attempted_at",
      "2026-10-04T06:20:00.000Z",
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "candidate_unlock",
        detail: { cleared: 2 },
      }),
    );
  });
});
