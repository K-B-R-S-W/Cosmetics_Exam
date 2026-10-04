import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), assertSameOrigin: vi.fn(), upload: vi.fn(), process: vi.fn(), from: vi.fn(), remove: vi.fn(), load: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/question-images", () => ({ processQuestionImage: mocks.process }));
vi.mock("@/lib/question-server", async (original) => ({ ...(await original<typeof import("@/lib/question-server")>()), removeQuestionImageWithRetry: mocks.remove, loadQuestion: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ storage: { from: () => ({ upload: mocks.upload }) }, from: mocks.from, rpc: mocks.rpc }) }));

const adminId = "00000000-0000-4000-8000-000000000001";

describe("admin question image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: adminId });
    mocks.process.mockResolvedValue({ buffer: Buffer.alloc(321), mime: "image/webp", extension: "webp", width: 100, height: 50 });
    mocks.upload.mockResolvedValue({ data: { path: "x" }, error: null });
    mocks.remove.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.audit.mockResolvedValue(undefined);
  });

  it("checks Content-Length before buffering", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/admin/question-images", { method: "POST", headers: { Origin: "http://localhost", "Content-Length": "4259841", "Content-Type": "multipart/form-data; boundary=x" }, body: "--x--" });
    const formData = vi.spyOn(request, "formData");
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.assertSameOrigin.mock.invocationCallOrder[0]).toBeLessThan(mocks.requireAdmin.mock.invocationCallOrder[0]!);
  });

  it("allows multipart overhead while keeping the file limit separate", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/admin/question-images", { method: "POST", headers: { Origin: "http://localhost", "Content-Length": "4259840", "Content-Type": "multipart/form-data; boundary=x" }, body: "--x--" });
    vi.spyOn(request, "formData").mockRejectedValue(new Error("synthetic invalid multipart"));
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("uploads processed bytes and reports their MIME and size", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("synthetic")], { type: "image/webp" }), "image.webp");
    form.append("alt_text", "Synthetic image");
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/admin/question-images", { method: "POST", headers: { Origin: "http://localhost" }, body: form }));
    expect(response.status).toBe(201);
    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^questions/${adminId}/[0-9a-f-]{36}\\.webp$`)), expect.any(Buffer), {
      cacheControl: "31536000", contentType: "image/webp", upsert: false,
    });
    expect((await response.json()).image).toMatchObject({ alt_text: "Synthetic image", mime: "image/webp", size_bytes: 321 });
  });

  it("detaches an attached image through save_question before deleting its object", async () => {
    const questionId = "00000000-0000-4000-8000-000000000101";
    const path = `questions/${adminId}/00000000-0000-4000-8000-000000000105.jpg`;
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: questionId }], error: null }) }) }) });
    mocks.load.mockResolvedValue({
      id: questionId, exam_id: "00000000-0000-4000-8000-000000000102", position: 0, type: "written", body_html: "<p>Question</p>", marks: 1,
      image: { path, alt_text: "Image", mime: "image/jpeg", size_bytes: 100 }, options: [],
      answer_key: { correct_option_id: null, model_answer: "Answer", grading_notes: null, calibration: [] },
    });
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/admin/question-images", { method: "DELETE", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ path, question_id: questionId }) }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("save_question", expect.objectContaining({ p_question_id: questionId, p_image_path: null }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]!);
  });
});
