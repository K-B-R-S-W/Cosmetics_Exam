import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { isResultFinal, loadResultsSummary, resolveResultsExamParam } from "./results-summary";

type Row = Record<string, unknown>;

function clientFor(overrides: Partial<Record<string, Row[] | Row | null | { error: unknown }>> = {}) {
  const defaults: Record<string, Row[] | Row | null> = {
    exams: { id: "exam-1", title: "Final Exam", flag_threshold: 10 },
    attempts: [
      { id: "attempt-1", candidate_id: "candidate-1", status: "finalized", submit_reason: "manual", violation_count: 2 },
      { id: "attempt-2", candidate_id: "candidate-2", status: "finalized", submit_reason: "auto", violation_count: 0 },
    ],
    candidates: [
      { id: "candidate-1", mer_code: "MER-1", full_name: "Candidate One", outlet: "Colombo" },
      { id: "candidate-2", mer_code: "MER-2", full_name: "නම", outlet: null },
    ],
    results: [{ attempt_id: "attempt-1", mcq_marks: 2, written_marks: 3, total_marks: 5, total_percent: 50 }],
    attempt_questions: [
      { attempt_id: "attempt-1", question_id: "q-written" },
      { attempt_id: "attempt-1", question_id: "q-mcq" },
    ],
    questions: [
      { id: "q-written", position: 6, type: "written" },
      { id: "q-mcq", position: 2, type: "mcq" },
    ],
    current_scores: [
      { attempt_id: "attempt-1", question_id: "q-written", needs_review: false },
      { attempt_id: "attempt-1", question_id: "q-mcq", needs_review: false },
    ],
    violation_events: [
      { attempt_id: "attempt-1" },
      { attempt_id: "attempt-1" },
      { attempt_id: "attempt-1" },
    ],
  };
  const values = { ...defaults, ...overrides };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const offsets = new Map<string, number>();
  const from = vi.fn((table: string) => {
    const builder = {
      select: (...args: unknown[]) => { calls.push({ table, method: "select", args }); return builder; },
      eq: (...args: unknown[]) => { calls.push({ table, method: "eq", args }); return builder; },
      in: (...args: unknown[]) => { calls.push({ table, method: "in", args }); return builder; },
      order: (...args: unknown[]) => { calls.push({ table, method: "order", args }); return builder; },
      range: (fromIndex: number, toIndex: number) => {
        calls.push({ table, method: "range", args: [fromIndex, toIndex] });
        offsets.set(table, fromIndex);
        const value = values[table];
        if (value && typeof value === "object" && !Array.isArray(value) && "error" in value) {
          return Promise.resolve({ data: null, error: value.error });
        }
        const data = Array.isArray(value) ? value.slice(fromIndex, toIndex + 1) : value;
        return Promise.resolve({ data, error: null });
      },
      maybeSingle: () => {
        calls.push({ table, method: "maybeSingle", args: [] });
        const value = values[table];
        if (value && typeof value === "object" && !Array.isArray(value) && "error" in value) {
          return Promise.resolve({ data: null, error: value.error });
        }
        return Promise.resolve({ data: value, error: null });
      },
      then: (resolve: (value: unknown) => unknown) => {
        const value = values[table];
        return Promise.resolve({ data: value, error: null }).then(resolve);
      },
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, offsets };
}

describe("loadResultsSummary", () => {
  it("classifies an absent finalized attempt independently of attempt status", async () => {
    const { client } = clientFor();
    const result = await loadResultsSummary(client, "exam-1", vi.fn());
    expect(result?.rows[1]).toMatchObject({ attempt_status: "finalized", submit_reason: "auto", is_absent: true, is_final: false, question_numbers: [] });
  });

  it("uses current scores, counts unscored written questions, reviews, and all logged violations", async () => {
    const { client } = clientFor({
      current_scores: [{ attempt_id: "attempt-1", question_id: "q-mcq", needs_review: true }],
    });
    const result = await loadResultsSummary(client, "exam-1", vi.fn());
    expect(result?.rows[0]).toMatchObject({ question_numbers: [3, 7], violations_counted: 2, violations_logged: 3, needs_review_count: 1, unscored_count: 1, is_final: false });
  });

  it("makes an MCQ-only result final when it has no review flags", async () => {
    const { client } = clientFor({
      attempt_questions: [{ attempt_id: "attempt-1", question_id: "q-mcq" }],
      questions: [{ id: "q-mcq", position: 2, type: "mcq" }],
      current_scores: [{ attempt_id: "attempt-1", question_id: "q-mcq", needs_review: false }],
    });
    const result = await loadResultsSummary(client, "exam-1", vi.fn());
    expect(result?.rows[0]).toMatchObject({ unscored_count: 0, needs_review_count: 0, is_final: true });
  });

  it("keeps marks blank and is_final false when a taken attempt has no results row", async () => {
    const { client } = clientFor({ results: [] });
    const result = await loadResultsSummary(client, "exam-1", vi.fn());
    expect(result?.rows[0]).toMatchObject({ mcq_marks: null, total_percent: null, is_absent: false, is_final: false });
  });

  it("reads every page when a related result exceeds 1000 rows", async () => {
    const events = Array.from({ length: 1005 }, () => ({ attempt_id: "attempt-1" }));
    const { client, calls } = clientFor({ violation_events: events });
    const result = await loadResultsSummary(client, "exam-1", vi.fn());
    expect(result?.rows[0]?.violations_logged).toBe(1005);
    expect(calls.filter((call) => call.table === "violation_events" && call.method === "range").map((call) => call.args)).toEqual([[0, 999], [1000, 1999]]);
  });

  it("logs and throws a safe code for a database error", async () => {
    const logger = vi.fn();
    const { client } = clientFor({ current_scores: { error: { message: "private marks" } } });
    await expect(loadResultsSummary(client, "exam-1", logger)).rejects.toThrow("results_summary_scores_failed");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("private marks");
  });
});

it("prefers exam and accepts exam_id as a backward-compatible fallback", () => {
  expect(resolveResultsExamParam({ exam: "new", exam_id: "old" })).toBe("new");
  expect(resolveResultsExamParam({ exam_id: "old" })).toBe("old");
});

it("shares the final-result rule", () => {
  expect(isResultFinal({ tookExam: true, hasResult: true, unscoredCount: 0, needsReviewCount: 0 })).toBe(true);
  expect(isResultFinal({ tookExam: false, hasResult: true, unscoredCount: 0, needsReviewCount: 0 })).toBe(false);
  expect(isResultFinal({ tookExam: true, hasResult: true, unscoredCount: 1, needsReviewCount: 0 })).toBe(false);
  expect(isResultFinal({ tookExam: true, hasResult: true, unscoredCount: 0, needsReviewCount: 1 })).toBe(false);
});
