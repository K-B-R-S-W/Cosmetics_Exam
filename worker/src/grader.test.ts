import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { createGradingRepository, insertScoreRowsIdempotently, loadGradingItems } from "./grader";

it("falls back per score after a crash-retry duplicate", async () => {
  const insert = vi.fn()
    .mockResolvedValueOnce({ error: { code: "23505" } })
    .mockResolvedValueOnce({ error: { code: "23505" } })
    .mockResolvedValueOnce({ error: null });
  await expect(insertScoreRowsIdempotently(insert, [{ id: "one" }, { id: "two" }])).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledTimes(3);
});

function query(data: unknown, error: unknown = null) {
  const calls: unknown[][] = [];
  const builder = {
    select: vi.fn((...args: unknown[]) => { calls.push(["select", ...args]); return builder; }),
    eq: vi.fn((...args: unknown[]) => { calls.push(["eq", ...args]); return builder; }),
    in: vi.fn((...args: unknown[]) => { calls.push(["in", ...args]); return builder; }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  return { builder, calls };
}

it("loads grading input through explicit foreign-key-independent queries", async () => {
  const assignment = query([{ question_id: "q1" }]);
  const question = query({ id: "q1", body_html: "<p>Question</p>", marks: "2", image_path: "questions/q1/image.jpg", image_alt_text: "A labelled skin diagram" });
  const key = query({ question_id: "q1", model_answer: "Answer", grading_notes: "Notes", calibration: [] });
  const answer = query([{ question_id: "q1", answer_text: "Candidate" }]);
  const byTable = { attempt_questions: assignment, questions: question, answer_keys: key, answers: answer };
  const client = { from: vi.fn((table: keyof typeof byTable) => byTable[table].builder) } as unknown as SupabaseClient;

  await expect(loadGradingItems(client, { id: "job", runId: "run", attemptId: "attempt", chunkIndex: 0, questionIds: ["q1"], tries: 0 })).resolves.toEqual([{
    questionId: "q1", questionHtml: "<p>Question</p>", questionImageDescription: "A labelled skin diagram", answerText: "Candidate", modelAnswer: "Answer",
    maxMarks: 2, gradingNotes: "Notes", calibration: [],
  }]);
  expect(assignment.calls).toEqual([["select", "question_id"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
  expect(question.calls).toEqual([["select", "id,body_html,marks,image_path,image_alt_text"], ["in", "id", ["q1"]]]);
  expect(key.calls).toEqual([["select", "question_id,model_answer,grading_notes,calibration"], ["in", "question_id", ["q1"]]]);
  expect(answer.calls).toEqual([["select", "question_id,answer_text"], ["eq", "attempt_id", "attempt"], ["in", "question_id", ["q1"]]]);
  for (const calls of Object.values(byTable).map((entry) => entry.calls)) {
    expect(String(calls[0]?.[1])).not.toContain("(");
  }
});

it("reports a safe database error from any explicit grading input query", async () => {
  const assignment = query([{ question_id: "q1" }]);
  const question = query(null, { code: "PGRST200", message: "relationship details must not escape" });
  const key = query([]);
  const answer = query([]);
  const byTable = { attempt_questions: assignment, questions: question, answer_keys: key, answers: answer };
  const client = { from: vi.fn((table: keyof typeof byTable) => byTable[table].builder) } as unknown as SupabaseClient;
  await expect(loadGradingItems(client, { id: "job", runId: "run", attemptId: "attempt", chunkIndex: 0, questionIds: ["q1"], tries: 0 })).rejects.toThrow("database_error");
});

it("resets null and expired running locks without resetting tries", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
  const calls: unknown[][] = [];
  const builder = {
    update: vi.fn((...args: unknown[]) => { calls.push(["update", ...args]); return builder; }),
    eq: vi.fn((...args: unknown[]) => { calls.push(["eq", ...args]); return builder; }),
    lt: vi.fn((...args: unknown[]) => { calls.push(["lt", ...args]); return builder; }),
    or: vi.fn((...args: unknown[]) => { calls.push(["or", ...args]); return builder; }),
    select: vi.fn((...args: unknown[]) => { calls.push(["select", ...args]); return Promise.resolve({ data: [{ id: "job" }], error: null }); }),
  };
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

  await expect(createGradingRepository(client).resetStuck(180_000)).resolves.toBe(1);

  expect(calls).toEqual([
    ["update", { status: "pending", locked_at: null, error: null }],
    ["eq", "status", "running"],
    ["or", "locked_at.is.null,locked_at.lt.2026-10-08T09:57:00.000Z"],
    ["select", "id"],
  ]);
  expect(JSON.stringify(calls)).not.toContain("tries");
  vi.useRealTimers();
});
