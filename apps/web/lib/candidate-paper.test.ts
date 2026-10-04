import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CandidateAuthContext } from "@/lib/candidate-session";
import { loadCandidatePaper } from "@/lib/candidate-paper";

const auth: CandidateAuthContext = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  candidateId: "00000000-0000-4000-8000-000000000002",
  attemptId: "00000000-0000-4000-8000-000000000003",
  examId: "00000000-0000-4000-8000-000000000004",
  attemptStatus: "acknowledged",
  currentPosition: 0,
  extraMinutes: 0,
  submitReason: null,
};
const q1 = "00000000-0000-4000-8000-000000000011";
const q2 = "00000000-0000-4000-8000-000000000012";
const o1 = "00000000-0000-4000-8000-000000000021";
const o2 = "00000000-0000-4000-8000-000000000022";

function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function client({
  mode = "free",
  status = "live",
  forceEnded = null,
  endsAt = "2026-10-04T11:00:00.000Z",
  rpcError = null,
}: {
  mode?: "free" | "sequential";
  status?: "draft" | "scheduled" | "live" | "ended" | "finalized";
  forceEnded?: string | null;
  endsAt?: string | null;
  rpcError?: { message: string } | null;
} = {}) {
  const assignments = [
    { attempt_id: auth.attemptId, question_id: q2, position: 0, option_order: [o2, o1] },
    { attempt_id: auth.attemptId, question_id: q1, position: 1, option_order: null },
  ];
  const questions = [
    { id: q1, type: "written", body_html: '<p onclick="bad()">සිංහල<script>secret</script></p>', image_path: null, image_alt_text: null, marks: "2.50", mcq_options: [] },
    { id: q2, type: "mcq", body_html: "<p>Choose</p>", image_path: "questions/a/image.png", image_alt_text: "Synthetic product", marks: 1, mcq_options: [{ id: o1, text_html: '<p><a href="javascript:bad()">First</a></p>' }, { id: o2, text_html: "<p>Second</p>" }] },
  ];
  const answers = [{ question_id: q2, answer_text: null, selected_option_id: o2, flagged: false, revision: 4 }];
  const from = vi.fn((table: string) => {
    if (table === "exams") return query({ data: { id: auth.examId, status, navigation_mode: mode, ends_at: endsAt, force_ended_at: forceEnded }, error: null });
    if (table === "questions") return query({ data: questions, error: null });
    if (table === "answers") return query({ data: answers, error: null });
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn().mockResolvedValue({ data: rpcError ? null : assignments, error: rpcError });
  return { from, rpc };
}

beforeEach(() => vi.restoreAllMocks());

describe("loadCandidatePaper", () => {
  it("restores saved paper/option order, sanitizes HTML, and exposes only candidate fields", async () => {
    const supabase = client();
    const paper = await loadCandidatePaper(auth, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00.000Z") });
    expect(paper.current_position).toBeNull();
    expect(paper.questions.map((question) => question.id)).toEqual([q2, q1]);
    expect(paper.questions[0]?.options?.map((option) => option.id)).toEqual([o2, o1]);
    expect(paper.questions[0]?.image).toEqual({ url: `/api/question-images/${q2}`, alt_text: "Synthetic product" });
    expect(paper.questions[1]?.body_html).toBe("<p>සිංහල</p>");
    expect(paper.questions[0]?.options?.[1]?.text_html).toBe("<p>First</p>");
    expect(paper.answers[q2]?.revision).toBe(4);
    const serialized = JSON.stringify(paper);
    for (const forbidden of ["answer_keys", "correct_option_id", "model_answer", "grading_notes", "calibration", "image_path", "label", "secret"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns only the current sequential question and its answer", async () => {
    const supabase = client({ mode: "sequential" });
    const paper = await loadCandidatePaper(auth, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00.000Z") });
    expect(paper.total_questions).toBe(2);
    expect(paper.current_position).toBe(0);
    expect(paper.questions.map((question) => question.id)).toEqual([q2]);
    expect(Object.keys(paper.answers)).toEqual([q2]);
  });

  it("allows the exact deadline boundary and rejects a passed deadline before the RPC", async () => {
    const atBoundary = client({ endsAt: "2026-10-04T10:00:00.000Z" });
    await expect(loadCandidatePaper(auth, { supabase: atBoundary as never, now: new Date("2026-10-04T10:00:00.000Z") })).resolves.toBeTruthy();
    expect(atBoundary.rpc).toHaveBeenCalledTimes(1);

    const passed = client({ endsAt: "2026-10-04T09:59:59.999Z" });
    await expect(loadCandidatePaper(auth, { supabase: passed as never, now: new Date("2026-10-04T10:00:00.000Z") })).rejects.toMatchObject({ code: "exam_closed", status: 409 });
    expect(passed.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["not_started", "not_acknowledged", 403],
    ["submitted", "attempt_closed", 409],
    ["finalized", "attempt_closed", 409],
  ] as const)("rejects %s before database work", async (attemptStatus, code, statusCode) => {
    const supabase = client();
    await expect(loadCandidatePaper({ ...auth, attemptStatus }, { supabase: supabase as never })).rejects.toMatchObject({ code, status: statusCode });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("rejects an exam that is not live or was force-ended before generation", async () => {
    for (const supabase of [client({ status: "scheduled" }), client({ forceEnded: "2026-10-04T09:00:00.000Z" })]) {
      await expect(loadCandidatePaper(auth, { supabase: supabase as never })).rejects.toMatchObject({ code: "exam_not_live" });
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["attempt_not_found", "not_found", 404],
    ["not_acknowledged", "not_acknowledged", 403],
    ["attempt_closed", "attempt_closed", 409],
    ["exam_not_live", "exam_not_live", 409],
    ["exam_has_no_questions", "exam_has_no_questions", 409],
  ])("maps %s without returning database text", async (databaseCode, apiCode, status) => {
    const supabase = client({ rpcError: { message: `${databaseCode}: hidden postgres detail` } });
    await expect(loadCandidatePaper(auth, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00.000Z") })).rejects.toMatchObject({ code: apiCode, status });
  });

  it("uses four sequential stages while the final two database requests run together", async () => {
    const supabase = client();
    await loadCandidatePaper(auth, { supabase: supabase as never, now: new Date("2026-10-04T10:00:00.000Z") });
    expect(supabase.from.mock.calls.map(([table]) => table)).toEqual(["exams", "questions", "answers"]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});
