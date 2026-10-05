import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.client }));
import { POST } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
function request(body = "{}") { return new Request("http://localhost/api/heartbeat", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body }); }

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ sessionId: id, candidateId: id });
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ out_result: "ok", out_state: {
    server_time: "2026-10-05 10:30:00+00", phase: "live",
    exam: { id, title: "Synthetic", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: "2026-10-05 10:00:00+00", ends_at: "2026-10-05 11:00:00+00", force_ended: false, question_count: 1 },
    attempt: { id, status: "in_progress", current_position: 0, extra_minutes: 0, deadline: "2026-10-05 11:00:00+00", submit_reason: null }, announcements: [],
  } }], error: null });
  mocks.client.mockReturnValue({ rpc: mocks.rpc });
});

describe("POST /api/heartbeat", () => {
  it("checks origin, auth and strict body before the RPC", async () => {
    const denied = await POST(new Request("http://localhost/api/heartbeat", { method: "POST", body: "{}" }));
    expect(denied.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect((await POST(request('{"extra":true}'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("parses a real RPC row and normalizes all timestamps", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ server_time: "2026-10-05T10:30:00.000Z", exam: { started_at: "2026-10-05T10:00:00.000Z" }, attempt: { deadline: "2026-10-05T11:00:00.000Z" } });
    expect(mocks.rpc).toHaveBeenCalledWith("candidate_heartbeat", { p_session_id: id });
  });

  it.each(["unauthenticated", "session_revoked"])("maps %s to 401", async (code) => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: code, out_state: null }], error: null });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});
