import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CandidateAuthContext } from "./candidate-session";
import { advanceCandidatePosition } from "./candidate-next";

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
const q1 = "00000000-0000-4000-8000-000000000011";
const q2 = "00000000-0000-4000-8000-000000000012";

function chain(result: unknown) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) value[method] = vi.fn(() => value);
  value.single = vi.fn().mockResolvedValue(result);
  value.then = (resolve: (next: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return value;
}

function client(result = "advanced", position = 1, endsAt = "2027-10-04T11:00:00.000Z") {
  const assignments = [
    { question_id: q1, position: 0, option_order: null, questions: { id: q1, type: "written", body_html: "<p>First</p>", image_path: null, image_alt_text: null, marks: 1, mcq_options: [] } },
    { question_id: q2, position: 1, option_order: null, questions: { id: q2, type: "written", body_html: "<p>Second</p>", image_path: null, image_alt_text: null, marks: 2, mcq_options: [] } },
  ];
  const answers = [{ question_id: q2, answer_text: "Saved", selected_option_id: null, flagged: false, revision: 4, updated_at: "2026-10-04T09:59:00.000Z" }];
  const from = vi.fn((table: string) => {
    if (table === "exams") return chain({ data: { status: "live", ends_at: endsAt, force_ended_at: null }, error: null });
    if (table === "attempt_questions") return chain({ data: assignments, error: null });
    if (table === "answers") return chain({ data: answers, error: null });
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({ data: [{ out_result: result, out_position: position }], error: null });
  return { from, rpc };
}

const input = { expected_position: 0, question_id: q1, answer_text: "Synthetic", selected_option_id: null, revision: 2 };

describe("advanceCandidatePosition", () => {
  it.each(["advanced", "already_advanced", "out_of_sync"] as const)("returns a candidate-safe question for %s", async (result) => {
    const supabase = client(result);
    const body = await advanceCandidatePosition(auth, input, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") });
    expect(body).toMatchObject({ result, position: 1, total_questions: 2, question: { id: q2 }, answer: { revision: 4, saved_at: "2026-10-04T09:59:00.000Z" } });
    expect(JSON.stringify(body)).not.toMatch(/answer_key|image_path|correct_option/);
  });

  it("checks the no-grace deadline before advance_position", async () => {
    const supabase = client("advanced", 1, "2026-10-04T09:59:59.999Z");
    await expect(advanceCandidatePosition(auth, input, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00Z") })).rejects.toMatchObject({ code: "exam_closed", status: 409 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("saves a non-blank direct last-question answer without submit_now", async () => {
    const supabase = client("last_question", 0);
    supabase.rpc
      .mockResolvedValueOnce({ data: [{ out_result: "last_question", out_position: 0 }], error: null })
      .mockResolvedValueOnce({ data: "saved", error: null });
    const body = await advanceCandidatePosition(auth, input, { supabase: supabase as never });
    expect(body).toEqual(expect.objectContaining({ result: "last_question", position: 0 }));
    expect(body).not.toHaveProperty("submit_now");
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "save_answer", expect.objectContaining({ p_answer_text: "Synthetic" }));
  });

  it("does not create an answer for a blank direct last question", async () => {
    const supabase = client("last_question", 0);
    await advanceCandidatePosition(auth, { ...input, answer_text: "   " }, { supabase: supabase as never });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["closed", "exam_closed", 409],
    ["wrong_question", "invalid_state", 409],
    ["not_sequential", "invalid_state", 409],
    ["not_found", "not_found", 404],
  ])("maps %s to %s", async (result, code, status) => {
    const supabase = client(result, 0);
    await expect(advanceCandidatePosition(auth, input, { supabase: supabase as never })).rejects.toMatchObject({ code, status });
  });
});
