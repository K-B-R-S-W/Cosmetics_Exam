import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), buildStateBody: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/exam-state", () => ({ buildStateBody: mocks.buildStateBody }));

import { GET } from "./route";

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "c", attemptId: "a", examId: "e" });
  mocks.buildStateBody.mockReset().mockResolvedValue({ server_time: "2026-10-04T10:00:00.000Z", phase: "waiting", exam: {}, attempt: {}, announcements: [] });
});

describe("GET /api/exam/state", () => {
  it("authenticates, builds state without mutation, and sends standard headers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(mocks.requireCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.buildStateBody).toHaveBeenCalledTimes(1);
  });
});
