import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadAttemptReview } from "./attempt-review";

function query(data: unknown, error: unknown = null) {
  const calls: unknown[][] = [];
  const builder = {
    select: vi.fn((...args: unknown[]) => { calls.push(["select", ...args]); return builder; }),
    eq: vi.fn((...args: unknown[]) => { calls.push(["eq", ...args]); return builder; }),
    in: vi.fn((...args: unknown[]) => { calls.push(["in", ...args]); return builder; }),
    order: vi.fn((...args: unknown[]) => { calls.push(["order", ...args]); return builder; }),
    maybeSingle: vi.fn(() => { calls.push(["maybeSingle"]); return Promise.resolve({ data, error }); }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  return { builder, calls };
}

function fixture(status: string, failure?: keyof ReturnType<typeof tables>) {
  const values = tables(status);
  if (failure) values[failure] = query(null, { code: "PGRST200", message: "candidate answer must stay private" });
  const client = { from: vi.fn((table: keyof typeof values) => values[table].builder) } as unknown as SupabaseClient;
  return { values, client };
}

function tables(status: string) {
  return {
    attempts: query({ id: "attempt", status, candidates: { mer_code: "MER-1", full_name: "Candidate" } }),
    attempt_questions: query([{ question_id: "q1", position: 0, questions: [{ id: "q1", body_html: "<p>Question</p>", marks: 2 }] }]),
    answer_keys: query({ question_id: "q1", model_answer: "Model" }),
    answers: query([{ question_id: "q1", answer_text: "Answer" }]),
    current_scores: query([{ question_id: "q1", source: "ai", marks: 1, reason: "Partial", needs_review: true, details: { confidence: 0.5 } }]),
  };
}

describe.each(["not_started", "acknowledged", "in_progress", "submitted", "finalized"])("attempt status %s", (status) => {
  it("loads review data through supported query shapes", async () => {
    const { values, client } = fixture(status);
    const result = await loadAttemptReview(client, "attempt", vi.fn());
    expect(result?.status).toBe(status);
    expect(result?.items[0]).toMatchObject({ question_id: "q1", answer: "Answer", model_answer: "Model", max_marks: 2 });
    expect(values.attempts.calls).toEqual([["select", "id,status,candidates!inner(mer_code,full_name)"], ["eq", "id", "attempt"], ["maybeSingle"]]);
    expect(values.attempt_questions.calls).toEqual([["select", "question_id,position,questions!inner(id,body_html,marks)"], ["eq", "attempt_id", "attempt"], ["order", "position"]]);
    expect(values.answer_keys.calls).toEqual([["select", "question_id,model_answer"], ["in", "question_id", ["q1"]]]);
    expect(values.answers.calls).toEqual([["select", "question_id,answer_text"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
    expect(values.current_scores.calls).toEqual([["select", "question_id,source,marks,reason,needs_review,details"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
    expect(values.attempts.calls[0]?.[1]).not.toContain("attempt_questions(");
    expect(values.attempt_questions.calls[0]?.[1]).not.toContain("answers(");
    expect(values.attempt_questions.calls[0]?.[1]).not.toContain("answer_keys(");
  });
});

it("returns null only when the attempt lookup succeeds with no row", async () => {
  const missing = tables("submitted");
  missing.attempts = query(null);
  const client = { from: vi.fn((table: keyof typeof missing) => missing[table].builder) } as unknown as SupabaseClient;
  await expect(loadAttemptReview(client, "missing", vi.fn())).resolves.toBeNull();
});

it("throws and logs a safe code instead of presenting a database error as missing", async () => {
  const logger = vi.fn();
  const { client } = fixture("submitted", "answers");
  await expect(loadAttemptReview(client, "attempt", logger)).rejects.toThrow("attempt_review_answers_failed");
  expect(logger).toHaveBeenCalledWith("attempt_review_query_failed", { error_code: "attempt_review_answers_failed" });
  expect(JSON.stringify(logger.mock.calls)).not.toContain("candidate answer");
});
