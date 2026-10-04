import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { answerInputSchema, nextInputSchema, saveCandidateAnswer, submitInputSchema } from "./candidate-answers";

const input = {
  question_id: "00000000-0000-4000-8000-000000000011",
  answer_text: "Synthetic answer",
  selected_option_id: null,
  flagged: false,
  revision: 1,
};

function revisionQuery(revision: number) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { revision }, error: null });
  return chain;
}

describe("candidate answer validation", () => {
  it("accepts the contract boundary and rejects invalid identifiers, lengths, and revisions", () => {
    expect(answerInputSchema.parse({ ...input, answer_text: "x".repeat(20_000) })).toBeTruthy();
    expect(() => answerInputSchema.parse({ ...input, answer_text: "x".repeat(20_001) })).toThrow();
    expect(() => answerInputSchema.parse({ ...input, question_id: "not-a-uuid" })).toThrow();
    expect(() => answerInputSchema.parse({ ...input, selected_option_id: "not-a-uuid" })).toThrow();
    expect(() => answerInputSchema.parse({ ...input, revision: 0 })).toThrow();
    expect(() => nextInputSchema.parse({ ...input, expected_position: -1 })).toThrow();
  });

  it("caps pending answers at 200 and rejects forced", () => {
    expect(submitInputSchema.parse({ pending_answers: Array.from({ length: 200 }, () => input) }).pending_answers).toHaveLength(200);
    expect(() => submitInputSchema.parse({ pending_answers: Array.from({ length: 201 }, () => input) })).toThrow();
    expect(() => submitInputSchema.parse({ reason: "forced" })).toThrow();
  });
});

describe("saveCandidateAnswer", () => {
  it("uses one RPC for a saved answer", async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: "saved", error: null }), from: vi.fn() };
    await expect(saveCandidateAnswer(supabase as never, "attempt", input, new Date("2026-10-04T10:00:00Z"))).resolves.toMatchObject({ result: "saved", sent_revision: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith("save_answer", expect.objectContaining({ p_answer_text: "Synthetic answer", p_revision: 1 }));
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("reads the server revision only for stale_revision", async () => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: "stale_revision", error: null }), from: vi.fn(() => revisionQuery(9)) };
    await expect(saveCandidateAnswer(supabase as never, "attempt", input)).resolves.toMatchObject({ result: "stale_revision", server_revision: 9 });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["closed", "exam_closed", 409],
    ["wrong_position", "wrong_position", 409],
    ["not_in_paper", "not_in_paper", 400],
    ["bad_option", "bad_option", 400],
    ["not_found", "not_found", 404],
  ])("maps %s without exposing database detail", async (result, code, status) => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: result, error: null }) };
    await expect(saveCandidateAnswer(supabase as never, "attempt", input)).rejects.toMatchObject({ code, status });
  });
});
