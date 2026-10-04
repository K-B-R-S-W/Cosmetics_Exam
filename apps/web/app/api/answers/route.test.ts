import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), createClient: vi.fn(), save: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));
vi.mock("@/lib/candidate-answers", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("@/lib/candidate-answers")>();
  return { ...actual, saveCandidateAnswer: mocks.save };
});

import { POST } from "./route";

const body = { question_id: "00000000-0000-4000-8000-000000000011", answer_text: "Synthetic", selected_option_id: null, flagged: false, revision: 1 };
function request(value: unknown, origin = true) {
  return new Request("http://localhost/api/answers", { method: "POST", headers: { ...(origin ? { Origin: "http://localhost" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "candidate", attemptId: "attempt" });
  mocks.createClient.mockReset().mockReturnValue({});
  mocks.save.mockReset().mockResolvedValue({ result: "saved", server_time: "2026-10-04T10:00:00Z", sent_revision: 1 });
});

describe("POST /api/answers", () => {
  it("checks origin before auth, then authenticates before parsing", async () => {
    expect((await POST(request(body, false))).status).toBe(403);
    expect(mocks.requireCandidate).not.toHaveBeenCalled();
    const invalid = await POST(request({ ...body, revision: 0 }));
    expect(invalid.status).toBe(400);
    expect(mocks.requireCandidate).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns a no-store saved response", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ result: "saved", server_time: "2026-10-04T10:00:00Z" });
  });
});
