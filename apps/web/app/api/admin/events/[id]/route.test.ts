import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), client: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin, AdminAuthError: class extends Error {} }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.client }));
import { PATCH } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
function request(value: unknown, origin = true) { return new Request(`http://localhost/api/admin/events/${id}`, { method: "PATCH", headers: { ...(origin ? { Origin: "http://localhost" } : {}), "Content-Type": "application/json" }, body: JSON.stringify(value) }); }
beforeEach(() => { mocks.admin.mockReset().mockResolvedValue({ id }); mocks.rpc.mockReset().mockResolvedValue({ data: [{ out_result: "updated", out_counts: false, out_violation_count: 2 }], error: null }); mocks.client.mockReturnValue({ rpc: mocks.rpc }); });
describe("PATCH /api/admin/events/[id]", () => {
  it("checks origin then auth then strict body", async () => {
    expect((await PATCH(request({ dismissed: true, note: "Synthetic" }, false), { params: Promise.resolve({ id }) })).status).toBe(403);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect((await PATCH(request({ dismissed: true, note: "Synthetic", extra: 1 }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns the atomic RPC result", async () => {
    const response = await PATCH(request({ dismissed: true, note: "Synthetic" }), { params: Promise.resolve({ id }) });
    expect(await response.json()).toEqual({ event: { id, counts: false }, violation_count: 2 });
  });
  it.each([["not_found",404],["not_dismissable",409],["not_restorable",409]])("maps %s", async (result, status) => {
    mocks.rpc.mockResolvedValue({ data: [{ out_result: result, out_counts: false, out_violation_count: 2 }], error: null });
    expect((await PATCH(request({ dismissed: true, note: "Synthetic" }), { params: Promise.resolve({ id }) })).status).toBe(status);
  });
});
