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
    attempt_questions: query([{ question_id: "q1", position: 0, questions: [{ id: "q1", position: 6, type: "written", body_html: "<p>Question</p>", marks: 2 }] }]),
    answer_keys: query({ question_id: "q1", correct_option_id: null, model_answer: "Model" }),
    answers: query([{ question_id: "q1", answer_text: "Answer", selected_option_id: null }]),
    current_scores: query([{ question_id: "q1", source: "ai", marks: 1, reason: "Partial", needs_review: true, details: { confidence: 0.5 } }]),
    mcq_options: query([]),
  };
}

describe.each(["not_started", "acknowledged", "in_progress", "submitted", "finalized"])("attempt status %s", (status) => {
  it("loads review data through supported query shapes", async () => {
    const { values, client } = fixture(status);
    const result = await loadAttemptReview(client, "attempt", vi.fn());
    expect(result?.status).toBe(status);
    expect(result?.items[0]).toMatchObject({ question_id: "q1", type: "written", answer: "Answer", model_answer: "Model", selected_option: null, correct_option: null, max_marks: 2 });
    expect(values.attempts.calls).toEqual([["select", "id,status,candidates!inner(mer_code,full_name)"], ["eq", "id", "attempt"], ["maybeSingle"]]);
    expect(values.attempt_questions.calls).toEqual([["select", "question_id,position,questions!inner(id,position,type,body_html,marks)"], ["eq", "attempt_id", "attempt"], ["order", "position"]]);
    expect(result?.question_numbers).toEqual([7]);
    expect(values.answer_keys.calls).toEqual([["select", "question_id,correct_option_id,model_answer"], ["in", "question_id", ["q1"]]]);
    expect(values.answers.calls).toEqual([["select", "question_id,answer_text,selected_option_id"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
    expect(values.current_scores.calls).toEqual([["select", "question_id,source,marks,reason,needs_review,details"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
    expect(values.mcq_options.calls).toEqual([]);
    expect(client.from).not.toHaveBeenCalledWith("mcq_options");
    expect(values.attempts.calls[0]?.[1]).not.toContain("attempt_questions(");
    expect(values.attempt_questions.calls[0]?.[1]).not.toContain("answers(");
    expect(values.attempt_questions.calls[0]?.[1]).not.toContain("answer_keys(");
  });
});

it("loads the selected and correct MCQ options through one explicit query", async () => {
  const values = tables("finalized");
  values.attempt_questions = query([{ question_id: "q1", position: 0, questions: { id: "q1", position: 0, type: "mcq", body_html: "<p>Pick one</p>", marks: 1 } }]);
  values.answer_keys = query({ question_id: "q1", correct_option_id: "option-b", model_answer: null });
  values.answers = query([{ question_id: "q1", answer_text: null, selected_option_id: "option-a" }]);
  values.mcq_options = query([
    { id: "option-a", question_id: "q1", label: "a", text_html: "<p><strong>Candidate</strong> choice</p>" },
    { id: "option-b", question_id: "q1", label: "b", text_html: "<p>Correct&nbsp;choice</p>" },
  ]);
  const client = { from: vi.fn((table: keyof typeof values) => values[table].builder) } as unknown as SupabaseClient;

  const result = await loadAttemptReview(client, "attempt", vi.fn());

  expect(result?.items[0]).toMatchObject({
    type: "mcq",
    answer: "",
    model_answer: "",
    selected_option: { label: "a", text: "Candidate choice" },
    correct_option: { label: "b", text: "Correct choice" },
  });
  expect(values.mcq_options.calls).toEqual([["select", "id,question_id,label,text_html"], ["in", "question_id", ["q1"]]]);
  expect(client.from).toHaveBeenCalledWith("mcq_options");
});

it("returns no selected option for an unanswered MCQ", async () => {
  const values = tables("submitted");
  values.attempt_questions = query([{ question_id: "q1", position: 0, questions: { id: "q1", position: 0, type: "mcq", body_html: "Question", marks: 1 } }]);
  values.answer_keys = query([{ question_id: "q1", correct_option_id: "option-b", model_answer: null }]);
  values.answers = query([{ question_id: "q1", answer_text: null, selected_option_id: null }]);
  values.mcq_options = query([{ id: "option-b", question_id: "q1", label: "b", text_html: "Correct" }]);
  const client = { from: vi.fn((table: keyof typeof values) => values[table].builder) } as unknown as SupabaseClient;

  const result = await loadAttemptReview(client, "attempt", vi.fn());

  expect(result?.items[0]?.selected_option).toBeNull();
  expect(result?.items[0]?.correct_option).toEqual({ label: "b", text: "Correct" });
});

it("returns no selected option when the referenced option was deleted", async () => {
  const values = tables("submitted");
  values.attempt_questions = query([{ question_id: "q1", position: 0, questions: { id: "q1", position: 0, type: "mcq", body_html: "Question", marks: 1 } }]);
  values.answer_keys = query({ question_id: "q1", correct_option_id: "option-b", model_answer: null });
  values.answers = query([{ question_id: "q1", answer_text: null, selected_option_id: "deleted-option" }]);
  values.mcq_options = query([{ id: "option-b", question_id: "q1", label: "b", text_html: "Correct" }]);
  const client = { from: vi.fn((table: keyof typeof values) => values[table].builder) } as unknown as SupabaseClient;

  const result = await loadAttemptReview(client, "attempt", vi.fn());

  expect(result?.items[0]?.selected_option).toBeNull();
});

it("reports an MCQ options query failure with a safe code", async () => {
  const logger = vi.fn();
  const { values, client } = fixture("submitted", "mcq_options");
  values.attempt_questions = query([{ question_id: "q1", position: 0, questions: { id: "q1", position: 0, type: "mcq", body_html: "Question", marks: 1 } }]);

  await expect(loadAttemptReview(client, "attempt", logger)).rejects.toThrow("attempt_review_options_failed");
  expect(logger).toHaveBeenCalledWith("attempt_review_query_failed", { error_code: "attempt_review_options_failed" });
  expect(JSON.stringify(logger.mock.calls)).not.toContain("candidate answer");
});

it("keeps written answers unchanged and skips the MCQ options query", async () => {
  const { values, client } = fixture("finalized");

  const result = await loadAttemptReview(client, "attempt", vi.fn());

  expect(result?.items[0]).toMatchObject({ type: "written", answer: "Answer", model_answer: "Model", selected_option: null, correct_option: null });
  expect(values.mcq_options.calls).toEqual([]);
  expect(client.from).not.toHaveBeenCalledWith("mcq_options");
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
