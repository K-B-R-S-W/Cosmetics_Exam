import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), origin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn(), publish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/broadcast-server", () => ({ publishExamBroadcast: mocks.publish }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

const id = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ id }) };
const request = () => new Request(`http://localhost/api/admin/exams/${id}/force-end`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });

describe("POST /api/admin/exams/[id]/force-end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.publish.mockResolvedValue(undefined);
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: "audit-1" }], error: null }) }) }) }) });
  });

  it("uses the atomic RPC and leaves collection to the worker", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "ended", out_status: "ended", out_ends_at: "2030-01-01T00:00:00Z", out_force_ended_at: "2030-01-01T00:00:00Z", out_collection_deadline: "2030-01-01T00:00:15Z", out_collecting: 21, out_already_submitted: 2 }], error: null });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("force_end_exam", { p_exam_id: id });
    expect(mocks.rpc).not.toHaveBeenCalledWith("submit_attempt", expect.anything());
    expect(await response.json()).toMatchObject({ collecting: 21, already_submitted: 2 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for an already-ended retry with an existing audit row", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "already_ended", out_status: "ended", out_ends_at: "2030-01-01T00:00:00Z", out_force_ended_at: "2030-01-01T00:00:00Z", out_collection_deadline: "2030-01-01T00:00:15Z", out_collecting: 0, out_already_submitted: 23 }], error: null });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ already_ended: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("admin_actions");
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("heals a missing force-end audit and broadcast on retry", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "already_ended", out_status: "finalized", out_ends_at: "2030-01-01T00:00:00Z", out_force_ended_at: "2030-01-01T00:00:00Z", out_collection_deadline: "2030-01-01T00:00:15Z", out_collecting: 0, out_already_submitted: 23 }], error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ already_ended: true, exam: { status: "finalized" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "force_end", id, { collecting: 0, already_submitted: 23 });
    expect(mocks.publish).toHaveBeenCalledWith(id, { type: "exam_ended" });
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.publish.mock.invocationCallOrder[0]!);
  });

  it("fails closed when the retry audit lookup errors", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "already_ended", out_status: "ended", out_ends_at: "2030-01-01T00:00:00Z", out_force_ended_at: "2030-01-01T00:00:00Z", out_collection_deadline: "2030-01-01T00:00:15Z", out_collecting: 0, out_already_submitted: 23 }], error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "synthetic" } }) }) }) }) });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
