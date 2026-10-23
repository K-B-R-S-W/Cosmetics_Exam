import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), from: vi.fn(), rpc: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

const examId = "00000000-0000-4000-8000-000000000100";
function row(source_row: number, question = `Question ${source_row}`) {
  return { source_row, type: "written", question, option_a: "", option_b: "", option_c: "", option_d: "", option_e: "", option_f: "", option_g: "", option_h: "", option_i: "", option_j: "", correct: "", marks: "1", model_answer: "Model", grading_notes: "" };
}
function request(rows: ReturnType<typeof row>[], dry_run: boolean, force_rows: number[] = []) {
  return new Request("http://localhost/api/admin/questions/import", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: examId, rows, dry_run, force_rows }) });
}
function examQuery(status = "draft") { return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: examId, status }, error: null }) }) }) }; }
function questionsQuery(pages: unknown[][]) {
  let page = 0;
  return { select: () => ({ order: () => ({ range: async () => ({ data: pages[page++] ?? [], error: null }) }) }) };
}

describe("POST /api/admin/questions/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ id: "admin", role: "admin" });
    mocks.from.mockImplementation((table: string) => table === "exams" ? examQuery() : questionsQuery([[]]));
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.audit.mockResolvedValue(undefined);
  });

  it("performs a dry run without any writes", async () => {
    const { POST } = await import("./route");
    const response = await POST(request([row(2)], true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dry_run: true, ready: [2], issues: [] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("checks same-origin and admin access before reading import data", async () => {
    mocks.auth.mockRejectedValue(new AdminAuthError("forbidden", 403));
    const { POST } = await import("./route");
    const response = await POST(request([row(2)], true));
    expect(response.status).toBe(403);
    expect(mocks.origin).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("paginates duplicate detection beyond the database default limit", async () => {
    const first = Array.from({ length: 1_000 }, (_, index) => ({ exam_id: "other", type: "written", body_html: `<p>Old ${index}</p>`, mcq_options: [], exams: { title: "Archive" } }));
    const second = [{ exam_id: "other", type: "written", body_html: "<p>Question 2!</p>", mcq_options: [], exams: { title: "Paged Exam" } }];
    const query = questionsQuery([first, second]);
    mocks.from.mockImplementation((table: string) => table === "exams" ? examQuery() : query);
    const { POST } = await import("./route");
    const response = await POST(request([row(2, "QUESTION 2")], true));
    expect((await response.json()).issues).toEqual([expect.objectContaining({ row: 2, matching_exam: "Paged Exam" })]);
  });

  it("rejects a locked exam before duplicate scans or writes", async () => {
    mocks.from.mockImplementation((table: string) => table === "exams" ? examQuery("live") : questionsQuery([[]]));
    const { POST } = await import("./route");
    const response = await POST(request([row(2)], false));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps earlier successful rows and reports a later save failure", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "synthetic" } });
    const { POST } = await import("./route");
    const response = await POST(request([row(2), row(3)], false));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, issues: [{ row: 3, code: "save_failed", message: "This row could not be saved." }] });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "question_save", examId, { exam_id: examId, imported: 1, failed: 1 });
  });

  it("enforces written model answers server-side", async () => {
    const missing = { ...row(2), model_answer: "" };
    const { POST } = await import("./route");
    const response = await POST(request([missing], false));
    expect(await response.json()).toMatchObject({ imported: 0, issues: [expect.objectContaining({ code: "missing_model_answer" })] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
