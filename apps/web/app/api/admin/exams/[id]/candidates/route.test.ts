import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

function examQuery(status = "draft") {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "00000000-0000-4000-8000-000000000010", title: "Exam", status }, error: null }) }) }) };
}
function candidateLookup(rows: Array<{ id: string; active: boolean }>) {
  return { select: () => ({ in: async () => ({ data: rows, error: null }) }) };
}

describe("exam candidate unassign route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.from.mockReset(); mocks.rpc.mockReset(); mocks.requireAdmin.mockResolvedValue({ id: "admin-1" }); mocks.audit.mockResolvedValue(undefined); });
  it("calls the atomic RPC and maps blocked ids", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ removed: ["00000000-0000-4000-8000-000000000020"], blocked: ["00000000-0000-4000-8000-000000000021"] }], error: null });
    const { DELETE } = await import("./route");
    const request = new Request("http://localhost/api/admin/exams/00000000-0000-4000-8000-000000000010/candidates", { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ candidate_ids: ["00000000-0000-4000-8000-000000000020", "00000000-0000-4000-8000-000000000021"] }) });
    const response = await DELETE(request, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000010" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: ["00000000-0000-4000-8000-000000000020"], blocked: [{ candidate_id: "00000000-0000-4000-8000-000000000021", reason: "attempt_started" }] });
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
  });
  it("maps exam_locked from the RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "exam_locked" } });
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/admin/exams/00000000-0000-4000-8000-000000000010/candidates", { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ candidate_ids: ["00000000-0000-4000-8000-000000000020"] }) }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000010" }) });
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe("exam_locked");
  });
  it("maps exam_not_found from the RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "exam_not_found" } });
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/admin/exams/00000000-0000-4000-8000-000000000010/candidates", { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ candidate_ids: ["00000000-0000-4000-8000-000000000020"] }) }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000010" }) });
    expect(response.status).toBe(404); expect((await response.json()).error.code).toBe("not_found");
  });
  it("rejects the whole assignment when any candidate is missing or inactive", async () => {
    mocks.from.mockImplementation((table: string) => table === "exams" ? examQuery() : candidateLookup([{ id: "00000000-0000-4000-8000-000000000020", active: true }]));
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/exams/00000000-0000-4000-8000-000000000010/candidates", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ candidate_ids: ["00000000-0000-4000-8000-000000000020", "00000000-0000-4000-8000-000000000021"] }) }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000010" }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: "validation_failed", details: { invalid_count: 1 } });
    expect(body.error.message).not.toContain("00000000");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
