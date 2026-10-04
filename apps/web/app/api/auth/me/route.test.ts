import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));

import { GET } from "./route";

function terminal(result: unknown, count?: number) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: result, error: null });
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(resolve);
  return chain;
}

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ sessionId: "s", candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "not_started" });
  process.env.SNAPSHOT_RETENTION_DAYS = "14";
});

describe("GET /api/auth/me", () => {
  it("returns explicit candidate, exam and count data without answer tables", async () => {
    const tables: string[] = [];
    mocks.createClient.mockReturnValue({ from: (table: string) => {
      tables.push(table);
      if (table === "candidates") return terminal({ mer_code: "TEST-001", full_name: "Synthetic", outlet: "Training" });
      if (table === "exams") return terminal({ id: "e", title: "Exam", instructions: "Plain", scheduled_start_at: null, duration_min: 45, navigation_mode: "free", status: "scheduled" });
      return terminal(null, 20);
    } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ exam: { question_count: 20 }, rules: { snapshot_retention_days: 14 } });
    expect(tables).toEqual(["candidates", "exams", "questions"]);
    expect(tables).not.toContain("answer_keys");
  });
});
