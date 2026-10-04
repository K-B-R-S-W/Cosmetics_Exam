import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), rpc: vi.fn(), audit: vi.fn(), load: vi.fn(), verify: vi.fn(), preview: vi.fn(), remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/question-server", async (original) => ({
  ...(await original<typeof import("@/lib/question-server")>()),
  loadQuestion: mocks.load,
  verifyQuestionImage: mocks.verify,
  addPreviewUrl: mocks.preview,
  removeQuestionImageWithRetry: mocks.remove,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));

const questionId = "00000000-0000-4000-8000-000000000101";
const examId = "00000000-0000-4000-8000-000000000102";
const optionA = "00000000-0000-4000-8000-000000000103";
const optionB = "00000000-0000-4000-8000-000000000104";
const oldImage = { path: "questions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000105.jpg", alt_text: "Old", mime: "image/jpeg" as const, size_bytes: 123 };
const current = {
  id: questionId, exam_id: examId, position: 0, type: "mcq" as const, body_html: "<p>Question</p>", marks: 1, image: oldImage,
  options: [{ id: optionA, position: 0, label: "a", text_html: "A" }, { id: optionB, position: 1, label: "b", text_html: "B" }],
  answer_key: { correct_option_id: optionA, model_answer: null, grading_notes: null, calibration: [] },
};
function patch(value: unknown) {
  return new Request(`http://localhost/api/admin/questions/${questionId}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(value) });
}
const context = { params: Promise.resolve({ id: questionId }) };

describe("admin question detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.load.mockResolvedValue(current);
    mocks.verify.mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.preview.mockImplementation(async (_client, item) => item);
    mocks.remove.mockResolvedValue(true);
    mocks.audit.mockResolvedValue(undefined);
  });

  it("re-sends all stored image fields when PATCH omits image", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ body_html: "<p>Changed</p>" }), context);
    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), oldImage, questionId);
    expect(mocks.rpc).toHaveBeenCalledWith("save_question", expect.objectContaining({
      p_image_path: oldImage.path, p_image_alt_text: "Old", p_image_mime: "image/jpeg", p_image_size_bytes: 123,
    }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("removes the old object only after a successful image-changing RPC", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ image: null }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
    expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), oldImage.path, "admin-1");
  });

  it("does not remove the old object if the save fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "exam_locked" } });
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ image: null }), context);
    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects a type change before the RPC", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ type: "written" }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("type_immutable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("loads the old image before delete and removes it after the RPC", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request(`http://localhost/api/admin/questions/${questionId}`, { method: "DELETE", headers: { Origin: "http://localhost" } }), context);
    expect(response.status).toBe(200);
    expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]!);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
  });

  it("maps a live-exam delete rejection to exam_locked without removing Storage", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "exam_locked" } });
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request(`http://localhost/api/admin/questions/${questionId}`, { method: "DELETE", headers: { Origin: "http://localhost" } }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("exam_locked");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
