import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({ origin: vi.fn(), auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));

const id = "00000000-0000-4000-8000-000000000010";
const candidateId = "00000000-0000-4000-8000-000000000020";
const token = "00000000-0000-4000-8000-000000000030";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown = { claim_token: token }) => new Request(`http://localhost/api/exam/announcements/${id}/claim`, { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/exam/announcements/[id]/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ candidateId });
  });

  it("returns the recipient message and normalizes sent_at", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_display: true, out_message: "Exam team message", out_sent_at: "2026-10-07 10:20:00+00" }], error: null });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ display: true, announcement: { id, message: "Exam team message", sent_at: "2026-10-07T10:20:00.000Z" } });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_broadcast", { p_broadcast_id: id, p_candidate_id: candidateId, p_claim_token: token });
  });

  it.each(["non-recipient", "expired", "unknown", "already-shown"])("returns one indistinguishable non-display response for %s", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_display: false, out_message: null, out_sent_at: null }], error: null });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ display: false });
  });

  it("replays display true with the same token", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_display: true, out_message: "Replay", out_sent_at: "2026-10-07T10:20:00Z" }], error: null });
    const { POST } = await import("./route");
    await POST(request(), context);
    const response = await POST(request(), context);
    expect(await response.json()).toMatchObject({ display: true, announcement: { message: "Replay" } });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "claim_broadcast", expect.objectContaining({ p_claim_token: token }));
  });

  it.each([{ claim_token: "not-a-uuid" }, { claim_token: "00000000-0000-3000-8000-000000000030" }, {}])("rejects a bad body", async (body) => {
    const { POST } = await import("./route");
    const response = await POST(request(body), context);
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("strips unknown body keys", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_display: false, out_message: null, out_sent_at: null }], error: null });
    const { POST } = await import("./route");
    const response = await POST(request({ claim_token: token, ignored: "value" }), context);
    expect(response.status).toBe(200);
  });

  it("returns the candidate auth error", async () => {
    mocks.auth.mockRejectedValue(new ApiError("unauthenticated", 401, "Please sign in to continue."));
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(401);
  });

  it("maps an RPC failure to the normal generic 5xx response", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "synthetic" } });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal_error" } });
  });

  it("rejects the origin before authentication", async () => {
    mocks.origin.mockImplementation(() => { throw new ApiError("forbidden", 403, "Forbidden."); });
    const { POST } = await import("./route");
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
