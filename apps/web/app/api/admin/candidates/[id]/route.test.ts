import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertSameOrigin: vi.fn(),
  hashNic: vi.fn(),
  update: vi.fn(),
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
vi.mock("@/lib/hashing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashing")>()),
  hashNic: mocks.hashNic,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) =>
      table === "admin_actions"
        ? { insert: mocks.audit }
        : { update: mocks.update },
    ),
  })),
}));

describe("candidate detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test Admin",
      role: "admin",
    });
    mocks.audit.mockResolvedValue({ error: null });
    mocks.update.mockImplementation((changes: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "00000000-0000-4000-8000-000000000002",
              mer_code: "TEST-001",
              full_name: changes.full_name,
              outlet: "පුහුණු ශාඛාව",
              active: true,
              created_at: "2026-10-04T00:00:00.000Z",
            },
            error: null,
          }),
        })),
      })),
    }));
  });

  it("keeps the existing hash when an edit sends a blank NIC", async () => {
    const { PATCH } = await import("./route");
    const request = new Request(
      "http://localhost/api/admin/candidates/00000000-0000-4000-8000-000000000002",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({
          full_name: "සංස්කරණ පරීක්ෂක",
          nic: "   ",
        }),
      },
    );
    const response = await PATCH(request, {
      params: Promise.resolve({
        id: "00000000-0000-4000-8000-000000000002",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.hashNic).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      full_name: "සංස්කරණ පරීක්ෂක",
    });
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requireAdmin.mock.invocationCallOrder[0]!,
    );
  });
});
