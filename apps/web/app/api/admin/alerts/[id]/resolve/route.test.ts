import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn().mockResolvedValue({ id: "admin" }), origin: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireSuperAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ from: () => ({ update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: mocks.update }) }) }) }) }) }) }));

describe("POST alert resolve", () => {
  it("resolves and audits once", async () => {
    mocks.auth.mockResolvedValue({ id: "admin", name: "Admin", role: "super_admin" });
    mocks.update.mockResolvedValue({ data: { id: "00000000-0000-4000-8000-000000000001", resolved_at: new Date().toISOString() }, error: null });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/x", { method: "POST", headers: { Origin: "http://localhost" } }), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), { id: "admin", name: "Admin", role: "super_admin" }, "alert_resolve", expect.any(String), expect.anything());
  });
});
