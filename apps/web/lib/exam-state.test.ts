import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { CandidateAuthContext } from "./candidate-session";
import { attemptDeadline, buildStateBody, examPhase } from "./exam-state";

const auth: CandidateAuthContext = { sessionId: "s", candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "in_progress", currentPosition: 3, extraMinutes: 5, submitReason: null };

function client(exam: Record<string, unknown>, announcements: unknown[] = []) {
  const examSelect = vi.fn();
  const examChain: Record<string, unknown> = {};
  examChain.select = examSelect.mockImplementation(() => examChain);
  examChain.eq = vi.fn(() => examChain);
  examChain.single = vi.fn().mockResolvedValue({ data: exam, error: null });
  const announcementSelect = vi.fn();
  const announcementChain: Record<string, unknown> = {};
  announcementChain.select = announcementSelect.mockImplementation(() => announcementChain);
  announcementChain.eq = vi.fn(() => announcementChain);
  announcementChain.is = vi.fn(() => announcementChain);
  announcementChain.gte = vi.fn(() => announcementChain);
  announcementChain.order = vi.fn(() => announcementChain);
  announcementChain.limit = vi.fn().mockResolvedValue({ data: announcements, error: null });
  const from = vi.fn((table: string) => table === "exams" ? examChain : announcementChain);
  return { value: { from } as never, from, examSelect, announcementSelect, announcementChain };
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

  it("returns only ordered, capped, in-window announcements for this candidate", async () => {
    const db = client(
      { id: "e", title: "Exam", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: "2026-10-04T09:00:00.000Z", ends_at: "2026-10-04T11:00:00.000Z", force_ended_at: null, questions: [{ count: 23 }] },
      [
        { id: "00000000-0000-4000-8000-000000000001", sent_at: "2026-10-04T09:55:00.000Z", message: "must not leak" },
        { id: "00000000-0000-4000-8000-000000000002", sent_at: "2026-10-04T09:56:00.000Z" },
      ],
    );
    const body = await buildStateBody(auth, { supabase: db.value, now: new Date("2026-10-04T10:00:00.000Z") });
    expect(body).toMatchObject({ phase: "live", exam: { question_count: 23 }, attempt: { current_position: 3, extra_minutes: 5, deadline: "2026-10-04T11:05:00.000Z" } });
    expect(body.announcements).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", sent_at: "2026-10-04T09:55:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000002", sent_at: "2026-10-04T09:56:00.000Z" },
    ]);
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(db.from).toHaveBeenCalledWith("exams");
    expect(db.from).toHaveBeenCalledWith("broadcasts");
    expect(db.examSelect).toHaveBeenCalledWith("id,title,status,navigation_mode,scheduled_start_at,started_at,ends_at,force_ended_at,questions(count)");
    expect(db.announcementSelect).toHaveBeenCalledWith("id,sent_at,broadcast_recipients!inner(candidate_id,shown_at)");
    expect(db.announcementChain.eq).toHaveBeenCalledWith("exam_id", "e");
    expect(db.announcementChain.eq).toHaveBeenCalledWith("broadcast_recipients.candidate_id", "c");
    expect(db.announcementChain.is).toHaveBeenCalledWith("broadcast_recipients.shown_at", null);
    expect(db.announcementChain.gte).toHaveBeenCalledWith("sent_at", "2026-10-04T09:50:00.000Z");
    expect(db.announcementChain.order).toHaveBeenNthCalledWith(1, "sent_at", { ascending: true });
    expect(db.announcementChain.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(db.announcementChain.limit).toHaveBeenCalledWith(50);
  });
});
