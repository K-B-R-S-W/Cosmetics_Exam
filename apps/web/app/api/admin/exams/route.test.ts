import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), insert: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: () => ({ insert: mocks.insert }) }) }));

describe("exam collection route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockResolvedValue({ id: "admin-1", name: "Admin", role: "admin" }); mocks.audit.mockResolvedValue(undefined); mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "exam-1", title: "Synthetic Exam", instructions: null, scheduled_start_at: null, started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00Z" }, error: null }) }) }); });
  it("checks origin before auth/body and creates only a draft", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/exams", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Synthetic Exam", duration_min: 45 }) }));
    expect(response.status).toBe(201);
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
    const inserted = mocks.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted).toEqual(expect.objectContaining({ flag_threshold: 10 }));
    expect(inserted).not.toHaveProperty("status");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "exam_create", "exam-1");
  });
});
