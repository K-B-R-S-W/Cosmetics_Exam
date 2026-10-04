import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { CandidateAuthContext } from "./candidate-session";
import { attemptDeadline, buildStateBody, examPhase } from "./exam-state";

const auth: CandidateAuthContext = { sessionId: "s", candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "in_progress", currentPosition: 3, extraMinutes: 5, submitReason: null };

function client(exam: Record<string, unknown>) {
  const select = vi.fn();
  const chain: Record<string, unknown> = {};
  chain.select = select.mockImplementation(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: exam, error: null });
  const from = vi.fn(() => chain);
  return { value: { from } as never, from, select };
}

describe("exam state", () => {
  it("computes every phase in priority order", () => {
    const now = new Date("2026-10-04T10:00:00.000Z");
    expect(examPhase("submitted", "live", false, "2026-10-04T11:00:00.000Z", now)).toBe("submitted");
    expect(examPhase("in_progress", "live", false, "2026-10-04T10:00:00.000Z", now)).toBe("live");
    expect(examPhase("acknowledged", "scheduled", false, null, now)).toBe("waiting");
    expect(examPhase("in_progress", "live", true, "2026-10-04T11:00:00.000Z", now)).toBe("closed");
    expect(examPhase("in_progress", "live", false, "2026-10-04T09:59:59.000Z", now)).toBe("closed");
  });

  it("adds extra minutes to the exam deadline", () => {
    expect(attemptDeadline("2026-10-04T10:00:00.000Z", 5)).toBe("2026-10-04T10:05:00.000Z");
    expect(attemptDeadline(null, 5)).toBeNull();
  });

  it("uses one explicit exam/count query and performs no write", async () => {
    const db = client({ id: "e", title: "Exam", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: "2026-10-04T09:00:00.000Z", ends_at: "2026-10-04T11:00:00.000Z", force_ended_at: null, questions: [{ count: 23 }] });
    const body = await buildStateBody(auth, { supabase: db.value, now: new Date("2026-10-04T10:00:00.000Z") });
    expect(body).toMatchObject({ phase: "live", exam: { question_count: 23 }, attempt: { current_position: 3, extra_minutes: 5, deadline: "2026-10-04T11:05:00.000Z" }, announcements: [] });
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledWith("exams");
    expect(db.select).toHaveBeenCalledWith("id,title,status,navigation_mode,scheduled_start_at,started_at,ends_at,force_ended_at,questions(count)");
  });
});
