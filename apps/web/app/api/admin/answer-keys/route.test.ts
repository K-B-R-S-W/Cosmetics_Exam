import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));

const questionId = "00000000-0000-4000-8000-000000000101";
const examId = "00000000-0000-4000-8000-000000000102";
const optionId = "00000000-0000-4000-8000-000000000103";
function put(body: unknown) {
  return new Request("http://localhost/api/admin/answer-keys", { method: "PUT", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("answer key route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: questionId, exam_id: examId, type: "written", marks: "2.00", mcq_options: [] }, error: null }) }) }) });
  });

  it("allows an explicit key save in any exam status and returns regrade_needed", async () => {
    const body = { question_id: questionId, correct_option_id: null, model_answer: "Answer", grading_notes: "Notes", calibration: [{ answer: "Example", marks: 1, note: "Good" }] };
    const { PUT } = await import("./route");
    const response = await PUT(put(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer_key: body, regrade_needed: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "answer_key_save", questionId, {
      exam_id: examId, question_id: questionId, calibration_count: 1,
    });
  });

  it("maps grading_in_progress to 409", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "grading_in_progress" } });
    const { PUT } = await import("./route");
    const response = await PUT(put({ question_id: questionId, correct_option_id: null, model_answer: "Answer", grading_notes: null, calibration: [] }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("grading_in_progress");
  });

  it("rejects a calibration score above the question marks before the RPC", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(put({ question_id: questionId, correct_option_id: null, model_answer: "Answer", grading_notes: null, calibration: [{ answer: "A", marks: 2.01, note: "N" }] }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an MCQ correct option to belong to the question", async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: questionId, exam_id: examId, type: "mcq", marks: 1, mcq_options: [{ id: optionId }] }, error: null }) }) }) });
    const { PUT } = await import("./route");
    const response = await PUT(put({ question_id: questionId, correct_option_id: examId, model_answer: null, grading_notes: null, calibration: [] }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
