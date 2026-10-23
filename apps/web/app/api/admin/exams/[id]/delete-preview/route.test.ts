import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), counts: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: mocks.auth }));
vi.mock("@/lib/exam-delete", () => ({ loadExamDeleteCounts: mocks.counts }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from }) }));

const examId = "00000000-0000-4000-8000-000000000010";
const context = { params: Promise.resolve({ id: examId }) };

describe("GET /api/admin/exams/[id]/delete-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ id: "admin", role: "admin" });
    mocks.counts.mockResolvedValue({ questions: 2, assigned_candidates: 3, attempts: 4, results: 1 });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: examId, title: "Exam", status: "finalized" }, error: null }) }) }) });
  });

  it("returns the exact destructive-impact counts", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/admin/exams/${examId}/delete-preview`), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      exam: { id: examId, title: "Exam", status: "finalized" },
      counts: { questions: 2, assigned_candidates: 3, attempts: 4, results: 1 },
    });
  });
});
