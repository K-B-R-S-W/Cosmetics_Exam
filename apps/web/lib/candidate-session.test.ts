import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIronSession: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("iron-session", () => ({ getIronSession: mocks.getIronSession }));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));

import { requireCandidate } from "./candidate-session";

function query(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "a-secure-test-secret-that-is-over-32-characters";
  mocks.getIronSession.mockReset();
  mocks.createClient.mockReset();
});

describe("requireCandidate", () => {
  it("rejects a missing cookie without querying", async () => {
    mocks.getIronSession.mockResolvedValue({});
    await expect(requireCandidate()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([null, { id: "s", candidate_id: "c", revoked_at: "2026-10-04T00:00:00Z", attempts: { id: "a", exam_id: "e", status: "in_progress" } }])("rejects a missing or revoked session row", async (row) => {
    mocks.getIronSession.mockResolvedValue({ sid: "s" });
    mocks.createClient.mockReturnValue({ from: () => query(row) });
    await expect(requireCandidate()).rejects.toMatchObject({ code: "session_revoked" });
  });

  it("returns ids and status from one joined query", async () => {
    const chain = query({ id: "s", candidate_id: "c", revoked_at: null, attempts: { id: "a", exam_id: "e", status: "acknowledged" } });
    mocks.getIronSession.mockResolvedValue({ sid: "s" });
    mocks.createClient.mockReturnValue({ from: vi.fn(() => chain) });
    await expect(requireCandidate()).resolves.toEqual({ sessionId: "s", candidateId: "c", attemptId: "a", examId: "e", attemptStatus: "acknowledged" });
    expect((mocks.createClient.mock.results[0]?.value.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
