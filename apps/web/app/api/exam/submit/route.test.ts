import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), submit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/candidate-submit", () => ({ submitCandidateAttempt: mocks.submit }));

import { POST } from "./route";

function request(value: unknown, contentLength?: number) { return new Request("http://localhost/api/exam/submit", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", ...(contentLength ? { "Content-Length": String(contentLength) } : {}) }, body: JSON.stringify(value) }); }

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "candidate", attemptId: "attempt" });
  mocks.submit.mockReset().mockResolvedValue({ submitted: true, already_submitted: false, save_results: [], server_time: "2026-10-04T10:00:00Z" });
});

describe("POST /api/exam/submit", () => {
  it("rejects forced and accepts an early auto hint for server derivation", async () => {
    expect((await POST(request({ reason: "forced" }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect((await POST(request({ reason: "auto" }))).status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), { reason: "auto", pending_answers: [] });
  });

  it("accepts 100 pending answers and keeps the response private", async () => {
    const pending_answers = Array.from({ length: 100 }, (_, index) => ({
      question_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      answer_text: "Synthetic",
      selected_option_id: null,
      flagged: false,
      revision: 1,
    }));
    const response = await POST(request({ pending_answers }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pending_answers }));
  });

  it("accepts 200 maximum-length Sinhala answers within 16 MiB", async () => {
    const pending_answers = Array.from({ length: 200 }, (_, index) => ({
      question_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      answer_text: "අ".repeat(20_000),
      selected_option_id: null,
      flagged: false,
      revision: 1,
    }));
    expect((await POST(request({ pending_answers }))).status).toBe(200);
    const invalid = await POST(request({ pending_answers: [{ ...pending_answers[0], answer_text: "අ".repeat(20_001) }] }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "validation_failed" } });
    expect((await POST(request({}, 16 * 1024 * 1024 + 1))).status).toBe(413);
  });
});
