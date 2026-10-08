import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), from: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", () => ({ recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

const attempt = "00000000-0000-4000-8000-000000000020";
const question = "00000000-0000-4000-8000-000000000021";
let paperQuestion: { question_id: string; questions: { marks: number } } | null;

beforeEach(() => {
  mocks.auth.mockResolvedValue({ id: "admin" }); mocks.audit.mockResolvedValue(undefined);
  paperQuestion = { question_id: question, questions: { marks: 2 } };
  mocks.rpc.mockResolvedValue({ data: { total_marks: 1.5, total_percent: 75 }, error: null });
  mocks.from.mockImplementation((table: string) => {
    if (table === "attempts") return { select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: attempt, status: "finalized" }, error: null }) }) }) };
    if (table === "attempt_questions") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: paperQuestion, error: null })) }) }) }) };
    return { insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "score" }, error: null }) }) }) };
  });
});

it("uses the documented not_in_paper and marks_out_of_range errors", async () => {
  const { POST } = await import("./route");
  paperQuestion = null;
  const missing = await POST(new Request(`http://localhost/api/admin/results/${attempt}/override`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ question_id: question, marks: 1, note: "Synthetic" }) }), { params: Promise.resolve({ attempt }) });
  expect(missing.status).toBe(400); expect((await missing.json()).error.code).toBe("not_in_paper");
  paperQuestion = { question_id: question, questions: { marks: 1 } };
  const high = await POST(new Request(`http://localhost/api/admin/results/${attempt}/override`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ question_id: question, marks: 1.5, note: "Synthetic" }) }), { params: Promise.resolve({ attempt }) });
  expect(high.status).toBe(400); expect((await high.json()).error.code).toBe("marks_out_of_range");
});

it("returns the documented current score and authoritative recomputed result", async () => {
  const { POST } = await import("./route");
  const response = await POST(new Request(`http://localhost/api/admin/results/${attempt}/override`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ question_id: question, marks: 1.5, note: "Synthetic review" }) }), { params: Promise.resolve({ attempt }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ current: { question_id: question, marks: 1.5, max_marks: 2, source: "override" }, results: { total_marks: 1.5, total_percent: 75 } });
  expect(mocks.rpc).toHaveBeenCalledWith("recompute_results", { p_attempt_id: attempt });
});

it("rejects unknown body fields before database access", async () => {
  const { POST } = await import("./route");
  const response = await POST(new Request(`http://localhost/api/admin/results/${attempt}/override`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ question_id: question, marks: 1, note: "Synthetic", extra: true }) }), { params: Promise.resolve({ attempt }) });
  expect(response.status).toBe(400); expect(mocks.from).not.toHaveBeenCalled();
});
