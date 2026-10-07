import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), origin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn(), publish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/broadcast-server", () => ({ publishExamBroadcast: mocks.publish }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

const id = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ id }) };

describe("POST /api/admin/exams/[id]/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", name: "Admin", role: "admin" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.publish.mockResolvedValue(undefined);
  });

  it("starts through the shared RPC, audits once and publishes a content-free nudge", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "started", out_status: "live", out_started_at: "2030-01-01T00:00:00Z", out_ends_at: "2030-01-01T01:00:00Z", out_missing: [] }], error: null });
    const { POST } = await import("./route");
    const response = await POST(new Request(`http://localhost/api/admin/exams/${id}/start`, { method: "POST", headers: { Origin: "http://localhost" } }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("start_exam", { p_exam_id: id, p_scheduled_only: false });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "start", id, expect.objectContaining({ ends_at: "2030-01-01T01:00:00Z" }));
    expect(mocks.publish).toHaveBeenCalledWith(id, { type: "exam_started" });
    expect(mocks.origin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
  });

  it("returns an already-started admin retry without another audit or broadcast", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "invalid_status", out_status: "live", out_started_at: "2030-01-01T00:00:00Z", out_ends_at: "2030-01-01T01:00:00Z", out_missing: [] }], error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 1 }], error: null }) }) }) }) });
    const { POST } = await import("./route");
    const response = await POST(new Request(`http://localhost/api/admin/exams/${id}/start`, { method: "POST", headers: { Origin: "http://localhost" } }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ already_started: true, exam: { status: "live" } });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
