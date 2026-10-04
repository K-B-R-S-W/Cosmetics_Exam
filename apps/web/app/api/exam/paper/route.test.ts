import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), loadCandidatePaper: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/candidate-paper", () => ({ loadCandidatePaper: mocks.loadCandidatePaper }));

import { GET } from "./route";
import { ApiError } from "@/lib/api";

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "candidate", attemptId: "attempt" });
  mocks.loadCandidatePaper.mockReset().mockResolvedValue({ server_time: "2026-10-04T10:00:00.000Z", navigation_mode: "free", total_questions: 0, current_position: null, questions: [], answers: {} });
});

describe("GET /api/exam/paper", () => {
  it("authenticates on every call and sends standard candidate headers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(mocks.requireCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.loadCandidatePaper).toHaveBeenCalledTimes(1);
  });

  it("returns the same mapped paper on retry without adding response fields", async () => {
    const paper = { server_time: "2026-10-04T10:00:00.000Z", navigation_mode: "free", total_questions: 1, current_position: null, questions: [{ id: "q", position: 0 }], answers: {} };
    mocks.loadCandidatePaper.mockResolvedValue(paper);
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).not.toMatch(/answer_keys|correct_option_id|model_answer|grading_notes|calibration/);
  });

  it.each([
    ["unauthenticated", "Please sign in to continue."],
    ["session_revoked", "This session is no longer active."],
  ])("preserves the %s candidate auth error", async (code, message) => {
    mocks.requireCandidate.mockRejectedValueOnce(new ApiError(code, 401, message));
    const response = await GET();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatchObject({ code, message });
    expect(mocks.loadCandidatePaper).not.toHaveBeenCalled();
  });

  it.each([
    ["exam_closed", "The exam has ended."],
    ["exam_not_live", "The exam hasn't started yet."],
  ])("preserves the %s paper-state response", async (code, message) => {
    mocks.loadCandidatePaper.mockRejectedValueOnce(new ApiError(code, 409, message));
    const response = await GET();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({ code, message, details: null });
  });
});
