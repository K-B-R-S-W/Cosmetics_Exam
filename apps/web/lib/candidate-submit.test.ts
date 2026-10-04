import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: logMocks }));

import type { CandidateAuthContext } from "./candidate-session";
import { submitCandidateAttempt } from "./candidate-submit";

const auth: CandidateAuthContext = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  candidateId: "00000000-0000-4000-8000-000000000002",
  attemptId: "00000000-0000-4000-8000-000000000003",
  examId: "00000000-0000-4000-8000-000000000004",
  attemptStatus: "in_progress",
  currentPosition: 0,
  extraMinutes: 0,
  submitReason: null,
};

function examQuery(exam: Record<string, unknown>) {
  const value: Record<string, unknown> = {};
  value.select = vi.fn(() => value);
  value.eq = vi.fn(() => value);
  value.single = vi.fn().mockResolvedValue({ data: exam, error: null });
  return value;
}

function answer(index: number) {
  return { question_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, answer_text: `Synthetic ${index}`, selected_option_id: null, flagged: false, revision: 1 };
}

describe("submitCandidateAttempt", () => {
  it("coerces early auto to manual and remains idempotent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { from: vi.fn(() => examQuery({ status: "live", ends_at: "2026-10-04T11:00:00Z", force_ended_at: null })), rpc };
    const result = await submitCandidateAttempt(auth, { reason: "auto", pending_answers: [] }, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") });
    expect(result.already_submitted).toBe(false);
    expect(rpc).toHaveBeenCalledWith("submit_attempt", { p_attempt_id: auth.attemptId, p_reason: "manual" });

    const repeat = await submitCandidateAttempt({ ...auth, attemptStatus: "submitted" }, { reason: "manual", pending_answers: [] }, { supabase: supabase as never });
    expect(repeat.already_submitted).toBe(true);
  });

  it("derives auto after the deadline and forced after force-end", async () => {
    for (const [exam, reason] of [
      [{ status: "live", ends_at: "2026-10-04T09:59:55Z", force_ended_at: null }, "auto"],
      [{ status: "ended", ends_at: "2026-10-04T11:00:00Z", force_ended_at: "2026-10-04T09:59:55Z" }, "forced"],
    ] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
      const supabase = { from: vi.fn(() => examQuery(exam)), rpc };
      await submitCandidateAttempt(auth, { reason: "manual", pending_answers: [] }, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") });
      expect(rpc).toHaveBeenCalledWith("submit_attempt", expect.objectContaining({ p_reason: reason }));
    }
  });

  it("rejects waiting-room and expired collection requests", async () => {
    await expect(submitCandidateAttempt({ ...auth, attemptStatus: "acknowledged" }, { reason: "manual", pending_answers: [] }, { supabase: {} as never })).rejects.toMatchObject({ code: "not_started" });
    const supabase = { from: vi.fn(() => examQuery({ status: "live", ends_at: "2026-10-04T09:59:40Z", force_ended_at: null })), rpc: vi.fn() };
    await expect(submitCandidateAttempt(auth, { reason: "auto", pending_answers: [] }, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") })).rejects.toMatchObject({ code: "collection_closed" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("saves 100 pending answers with at most eight concurrent RPCs and always submits", async () => {
    let active = 0;
    let peak = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === "submit_attempt") return { data: true, error: null };
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { data: "saved", error: null };
    });
    const supabase = { from: vi.fn(() => examQuery({ status: "live", ends_at: "2026-10-04T11:00:00Z", force_ended_at: null })), rpc };
    const result = await submitCandidateAttempt(auth, { reason: "manual", pending_answers: Array.from({ length: 100 }, (_, index) => answer(index + 1)) }, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") });
    expect(result.save_results).toHaveLength(100);
    expect(peak).toBeLessThanOrEqual(8);
    expect(rpc).toHaveBeenLastCalledWith("submit_attempt", expect.anything());
    expect(logMocks.info).toHaveBeenCalledWith("candidate_submit_pending_answers", {
      actorId: auth.candidateId,
      itemCount: 100,
      successCount: 100,
      failureCount: 0,
    });
    expect(JSON.stringify(logMocks.info.mock.calls)).not.toContain("Synthetic");
  });

  it("records individual save failures but still submits", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "bad_option", error: null })
      .mockResolvedValueOnce({ data: "saved", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const supabase = { from: vi.fn(() => examQuery({ status: "live", ends_at: "2026-10-04T11:00:00Z", force_ended_at: null })), rpc };
    const result = await submitCandidateAttempt(auth, { reason: "manual", pending_answers: [answer(1), answer(2)] }, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") });
    expect(result.save_results.map((item) => item.result)).toEqual(["bad_option", "saved"]);
    expect(result.submitted).toBe(true);
  });
});
