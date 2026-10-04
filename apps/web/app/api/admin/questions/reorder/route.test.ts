import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));

const examId = "00000000-0000-4000-8000-000000000102";
const ids = ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000103"];

describe("question reorder route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    mocks.audit.mockResolvedValue(undefined);
  });

  it("calls the atomic reorder RPC and audits counts", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/questions/reorder", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: examId, ordered_ids: ids }) }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("reorder_questions", { p_exam_id: examId, p_ordered_ids: ids });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "question_reorder", examId, { exam_id: examId, question_count: 2 });
  });

  it("maps the live-exam lock and rejects duplicate IDs before the RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "exam_locked" } });
    const { POST } = await import("./route");
    const locked = await POST(new Request("http://localhost/api/admin/questions/reorder", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: examId, ordered_ids: ids }) }));
    expect(locked.status).toBe(409);
    mocks.rpc.mockClear();
    const invalid = await POST(new Request("http://localhost/api/admin/questions/reorder", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: examId, ordered_ids: [ids[0], ids[0]] }) }));
    expect(invalid.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
