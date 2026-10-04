import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), rpc: vi.fn(), from: vi.fn(), audit: vi.fn(), logger: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logger, warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc, storage: { from: vi.fn() } }) }));

const ids = {
  question: "00000000-0000-4000-8000-000000000101",
  exam: "00000000-0000-4000-8000-000000000102",
  a: "00000000-0000-4000-8000-000000000103",
  b: "00000000-0000-4000-8000-000000000104",
};
const body = {
  id: ids.question, exam_id: ids.exam, type: "mcq", body_html: '<p onclick="bad()">Which?</p>', image: null, marks: 1,
  position: null, options: [{ id: ids.a, text_html: "<h2>A</h2>" }, { id: ids.b, text_html: "B" }],
  answer_key: { correct_option_id: ids.a, model_answer: null, grading_notes: null, calibration: [] },
};
const saved = {
  id: ids.question, exam_id: ids.exam, position: 0, type: "mcq", body_html: "<p>Which?</p>", image_path: null,
  image_alt_text: null, image_mime: null, image_size_bytes: null, marks: "1.00",
  mcq_options: [{ id: ids.a, position: 0, label: "a", text_html: "A" }, { id: ids.b, position: 1, label: "b", text_html: "B" }],
  answer_keys: [{ question_id: ids.question, correct_option_id: ids.a, model_answer: null, grading_notes: null, calibration: [] }],
};

function request(value: unknown = body, contentLength?: number) {
  return new Request("http://localhost/api/admin/questions", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json", ...(contentLength ? { "Content-Length": String(contentLength) } : {}) },
    body: JSON.stringify(value),
  });
}

describe("admin questions collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: [{ out_question_id: ids.question, out_position: 0 }], error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: saved, error: null }) }) }) });
  });

  it("returns answer data only after admin authorization", async () => {
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ order: async () => ({ data: [saved], error: null }) }) }) });
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/admin/questions?exam_id=${ids.exam}`));
    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect((await response.json()).items[0].answer_key.correct_option_id).toBe(ids.a);
  });

  it("sanitizes, calls the RPC, and audits IDs and counts only", async () => {
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
    expect(mocks.rpc).toHaveBeenCalledWith("save_question", expect.objectContaining({
      p_question_id: ids.question,
      p_body_html: "<p>Which?</p>",
      p_options: [{ id: ids.a, text_html: "A" }, { id: ids.b, text_html: "B" }],
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "question_save", ids.question, {
      exam_id: ids.exam, question_id: ids.question, option_count: 2,
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Which");
  });

  it("rejects invalid option IDs before calling the RPC", async () => {
    const { POST } = await import("./route");
    const response = await POST(request({ ...body, options: [{ id: "bad", text_html: "A" }, body.options[1]] }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects JSON requests over 200 KB before parsing", async () => {
    const { POST } = await import("./route");
    const response = await POST(request(body, 204_801));
    expect(response.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["exam_locked", 409, "exam_locked"],
    ["exam_not_found", 404, "not_found"],
    ["type_immutable", 400, "type_immutable"],
    ["bad_correct_option", 400, "validation_failed"],
  ])("maps RPC error %s without exposing database text", async (message, status, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("turns an unexpected database error into a logged generic 500", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "postgres secret detail" } });
    const { POST } = await import("./route");
    const response = await POST(request());
    const payload = await response.text();
    expect(response.status).toBe(500);
    expect(payload).not.toContain("postgres secret detail");
    expect(mocks.logger).toHaveBeenCalledWith("api_request_failed", expect.objectContaining({ route: "/api/admin/questions", status: 500 }));
  });
});
