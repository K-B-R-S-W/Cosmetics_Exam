import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", () => ({ recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

const id = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ id }) };
describe("POST grade", () => {
  beforeEach(() => { mocks.auth.mockResolvedValue({ id: "admin" }); mocks.from.mockReturnValue({ select: () => ({ eq: vi.fn().mockResolvedValue({ data: [{ label: "key1" }], error: null }) }) }); mocks.rpc.mockResolvedValue({ data: { run_id: "run", jobs: 2, estimated_calls: 2 }, error: null }); mocks.audit.mockResolvedValue(undefined); });
  it("accepts an omitted body and audits the committed run", async () => {
    const { POST } = await import("./route"); const response = await POST(new Request(`http://localhost/api/admin/exams/${id}/grade`, { method: "POST", headers: { Origin: "http://localhost" } }), context);
    expect(response.status).toBe(202); expect(mocks.rpc).toHaveBeenCalledWith("start_grading", expect.objectContaining({ p_chunk_size: 10, p_mcq_only: false })); expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "grade_start", id, expect.anything());
  });
  it("rejects unknown body keys before database work", async () => {
    const { POST } = await import("./route"); const response = await POST(new Request(`http://localhost/api/admin/exams/${id}/grade`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ extra: true }) }), context);
    expect(response.status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
