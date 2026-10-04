import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), createClient: vi.fn(), destroy: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ readCandidateSessionId: mocks.readSession }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));

import { POST } from "./route";

function req() { return new Request("http://localhost/api/auth/logout", { method: "POST", headers: { Origin: "http://localhost" } }); }
function updateQuery() { const chain: Record<string, unknown> = {}; for (const method of ["update", "eq", "is"]) chain[method] = vi.fn(() => chain); chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve); return chain; }

beforeEach(() => { mocks.destroy.mockReset(); mocks.readSession.mockReset(); mocks.createClient.mockReset(); });

describe("POST /api/auth/logout", () => {
  it.each([undefined, "session-id"])("is idempotent with session %s and always clears the cookie", async (sessionId) => {
    mocks.readSession.mockResolvedValue({ session: { destroy: mocks.destroy }, sessionId });
    const from = vi.fn(() => updateQuery());
    mocks.createClient.mockReturnValue({ from });
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(sessionId ? 1 : 0);
  });
});
