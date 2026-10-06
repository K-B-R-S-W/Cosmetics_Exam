import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin, AdminAuthError: class extends Error {} }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: mocks.from }) }));
import { GET } from "./route";

const examId = "00000000-0000-4000-8000-000000000001";
const exam = { id: examId, title: "Synthetic exam", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString(), flag_threshold: 10 };

function table(name: string) {
  if (name === "exams") return { select: () => ({ in: () => ({ order: async () => ({ data: [exam], error: null }) }) }) };
  if (name === "attempts") return { select: () => ({ eq: async () => ({ data: [{ id: "attempt-1", status: "in_progress", current_position: 0, extra_minutes: 0, last_seen_at: null, violation_count: 0, submitted_at: null, candidates: { id: "candidate-1", mer_code: "MER-1", full_name: "Synthetic Candidate", outlet: null } }], error: null }) }) };
  return { select: () => ({ eq: async () => ({ data: [{ attempt_id: "attempt-1", status: "in_progress", current_position: 0, total_questions: 10, answered_count: 2, flagged_count: 0 }], error: null }) }) };
}

beforeEach(() => { mocks.admin.mockReset().mockResolvedValue({ id: "admin" }); mocks.from.mockReset().mockImplementation(table); });

describe("GET /api/admin/live", () => {
  it("loads the selected exam, attempts and progress with explicit server-only access", async () => {
    const response = await GET(new Request(`http://localhost/api/admin/live?exam=${examId}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exam.id).toBe(examId);
    expect(body.attempts[0].candidate.mer_code).toBe("MER-1");
    expect(body.progress).toHaveLength(1);
    expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mocks.from.mock.calls.map(([name]) => name)).toEqual(["exams", "attempts", "attempt_progress"]);
  });

  it("uses one progress query after authentication for the ten-second poll", async () => {
    const response = await GET(new Request(`http://localhost/api/admin/live?view=progress&exam=${examId}`));
    expect(response.status).toBe(200);
    expect(mocks.from.mock.calls.map(([name]) => name)).toEqual(["attempt_progress"]);
  });

  it("strictly rejects unknown query keys and a missing progress exam", async () => {
    expect((await GET(new Request("http://localhost/api/admin/live?view=progress"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/admin/live?extra=1"))).status).toBe(400);
  });
});
