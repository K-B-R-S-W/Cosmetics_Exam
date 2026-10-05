import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), upload: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.client }));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]).toString("base64");
const body = { id, type: "FULLSCREEN_EXIT", merged_types: ["FOCUS_LOST"], occurred_ago_ms: 1000, duration_ms: 2000, meta: { source: "browser" }, snapshot_jpeg_base64: jpeg };
function request(value: unknown, origin = true) { return new Request("http://localhost/api/events", { method: "POST", headers: { ...(origin ? { Origin: "http://localhost" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(value) }); }
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ sessionId: id, candidateId: id });
  mocks.rpc.mockReset().mockResolvedValue({ data: [{ out_result: "inserted", out_event_id: id, out_counts: true, out_snapshot_path: `snapshots/e/a/${id}.jpg` }], error: null });
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.client.mockReturnValue({ rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.upload }) } });
});
describe("POST /api/events", () => {
  it("checks origin and auth before strict parsing", async () => {
    expect((await POST(request(body, false))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect((await POST(request({ ...body, unknown: true }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("calls the RPC and uploads only its reserved JPEG path", async () => {
    const response = await POST(request(body));
    expect(await response.json()).toEqual({ id, snapshot_saved: true });
    expect(mocks.upload).toHaveBeenCalledWith(`snapshots/e/a/${id}.jpg`, expect.any(Uint8Array), { contentType: "image/jpeg", upsert: false });
  });
  it("keeps duplicates idempotent and does not upload", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: "duplicate", out_event_id: id, out_counts: false, out_snapshot_path: null }], error: null });
    expect(await (await POST(request(body))).json()).toEqual({ id, duplicate: true, snapshot_saved: false });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("marks a reserved snapshot failed without exposing storage text", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "synthetic secret storage failure" } });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id, snapshot_saved: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith("mark_violation_snapshot_failed", { p_event_id: id });
  });
});
