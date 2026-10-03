import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
      })),
    })),
  })),
}));

describe("admin authorization", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.maybeSingle.mockReset();
  });

  it("returns the admin profile after verified Auth", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "admin-1", name: "Admin One", role: "admin" },
      error: null,
    });
    const { requireAdmin } = await import("@/lib/auth");

    await expect(requireAdmin()).resolves.toEqual({
      id: "admin-1",
      name: "Admin One",
      role: "admin",
    });
  });

  it("rejects a missing or invalid Auth user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid session"),
    });
    const { requireAdmin } = await import("@/lib/auth");

    await expect(requireAdmin()).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("returns forbidden when the Auth user has no admin profile", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const { requireAdmin } = await import("@/lib/auth");

    try {
      await requireAdmin();
      expect.unreachable("Expected a missing-profile failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "forbidden", status: 403 });
      const response = (error as { toResponse(): Response }).toResponse();
      expect(await response.json()).toEqual({
        error: {
          code: "forbidden",
          message: "You don't have permission to do that.",
          details: null,
        },
      });
    }
  });

  it("allows a super admin", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "super-1" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "super-1", name: "Super One", role: "super_admin" },
      error: null,
    });
    const { requireSuperAdmin } = await import("@/lib/auth");

    await expect(requireSuperAdmin()).resolves.toMatchObject({
      id: "super-1",
      role: "super_admin",
    });
  });

  it("rejects a regular admin from super-admin access", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "admin-1" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "admin-1", name: "Admin One", role: "admin" },
      error: null,
    });
    const { requireSuperAdmin } = await import("@/lib/auth");

    await expect(requireSuperAdmin()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });
});
