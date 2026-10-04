import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), advance: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/candidate-next", () => ({ advanceCandidatePosition: mocks.advance }));

import { POST } from "./route";

const body = { expected_position: 0, question_id: "00000000-0000-4000-8000-000000000011", answer_text: null, selected_option_id: null, revision: 1 };
function request(value: unknown) { return new Request("http://localhost/api/exam/next", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(value) }); }

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "candidate", attemptId: "attempt" });
  mocks.advance.mockReset().mockResolvedValue({ result: "last_question", position: 0, server_time: "2026-10-04T10:00:00Z" });
});

describe("POST /api/exam/next", () => {
  it("validates UUID, position, revision, and answer length before the server helper", async () => {
    for (const invalid of [
      { ...body, question_id: "bad" },
      { ...body, expected_position: -1 },
      { ...body, revision: 0 },
      { ...body, answer_text: "x".repeat(20_001) },
    ]) expect((await POST(request(invalid))).status).toBe(400);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("returns last_question without submit_now", async () => {
    const response = await POST(request(body));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({ result: "last_question", position: 0 }));
    expect(payload).not.toHaveProperty("submit_now");
  });
});
