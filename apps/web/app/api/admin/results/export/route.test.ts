import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/grading/results-summary", async (original) => ({ ...(await original<typeof import("@/lib/grading/results-summary")>()), loadResultsSummary: mocks.load }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ kind: "service" }) }));

const examId = "00000000-0000-4000-8000-000000000010";
const summary = {
  exam: { id: examId, title: "Final Exam 2026!", flag_threshold: 10 },
  rows: [
    { attempt_id: "a1", mer_code: "=cmd|' /C calc'!A0", full_name: "සිංහල, \"Name\"\nLine", outlet: "@SUM(1)", attempt_status: "finalized", submit_reason: "manual", violations_counted: 2, violations_logged: 3, question_numbers: [3, 7], mcq_marks: 2, written_marks: 3, total_marks: 5, total_percent: 50, needs_review_count: 0, unscored_count: 0, is_final: true, is_absent: false },
    { attempt_id: "a2", mer_code: "-1+1", full_name: "Absent", outlet: null, attempt_status: "finalized", submit_reason: "forced", violations_counted: 0, violations_logged: 0, question_numbers: [], mcq_marks: null, written_marks: null, total_marks: null, total_percent: null, needs_review_count: 0, unscored_count: 0, is_final: false, is_absent: true },
  ],
};

describe("GET /api/admin/results/export", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin", role: "admin" }); mocks.load.mockResolvedValue(summary); });

  it.each([["unauthenticated", 401], ["forbidden", 403]] as const)("refuses %s callers", async (code, status) => {
    mocks.auth.mockRejectedValue(new AdminAuthError(code, status));
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/admin/results/export?exam_id=${examId}`));
    expect(response.status).toBe(status);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("rejects an invalid exam id", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/results/export?exam_id=bad"));
    expect(response.status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown exam", async () => {
    mocks.load.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/admin/results/export?exam_id=${examId}`));
    expect(response.status).toBe(404);
  });

  it("exports every assigned candidate with BOM, exact columns, Sinhala, quoting and formula guards", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/admin/results/export?exam_id=${examId}`));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="results-final-exam-2026-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const withoutBom = csv;
    expect(withoutBom.startsWith("mer_code,full_name,outlet,attempt_status,submit_reason,violations_counted,violations_logged,questions_received,mcq_marks,written_marks,total_marks,total_percent,needs_review_count,unscored_count\r\n")).toBe(true);
    expect(withoutBom).toContain("'=cmd|' /C calc'!A0");
    expect(withoutBom).toContain("'@SUM(1)");
    expect(withoutBom).toContain("'-1+1");
    expect(withoutBom).toContain('"සිංහල, ""Name""\nLine"');
    expect(withoutBom).toContain(",3;7,2,3,5,50,0,0\r\n");
    const absent = withoutBom.split("\r\n").find((line) => line.startsWith("'-1+1,"));
    expect(absent).toContain(",finalized,,0,0,,,,,,0,0");
    expect(withoutBom.split("\r\n").filter(Boolean)).toHaveLength(3);
  });
});
