import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));

import { POST } from "./route";

function query(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  return chain;
}
function req(body: unknown) { return new Request("http://localhost/api/auth/acknowledge", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) }); }

beforeEach(() => { mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "not_started" }); mocks.createClient.mockReset(); });

describe("POST /api/auth/acknowledge", () => {
  it.each([{ identity_confirmed: false, rules_accepted: true }, { identity_confirmed: true, rules_accepted: false }])("requires both true", async (body) => {
    mocks.createClient.mockReturnValue({});
    const response = await POST(req(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
  });
  it("updates not_started and is idempotent for acknowledged", async () => {
    mocks.createClient.mockReturnValue({ from: (table: string) => table === "exams" ? query({ status: "scheduled" }) : query({ status: "acknowledged" }) });
    expect((await POST(req({ identity_confirmed: true, rules_accepted: true }))).status).toBe(200);
    mocks.requireCandidate.mockResolvedValue({ candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "acknowledged" });
    expect((await POST(req({ identity_confirmed: true, rules_accepted: true }))).status).toBe(200);
  });
  it("rejects a closed exam and a submitted attempt", async () => {
    mocks.createClient.mockReturnValue({ from: () => query({ status: "ended" }) });
    expect((await POST(req({ identity_confirmed: true, rules_accepted: true }))).status).toBe(409);
    mocks.requireCandidate.mockResolvedValue({ candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "submitted" });
    mocks.createClient.mockReturnValue({ from: () => query({ status: "live" }) });
    const response = await POST(req({ identity_confirmed: true, rules_accepted: true }));
    expect((await response.json()).error.code).toBe("already_submitted");
  });
});
