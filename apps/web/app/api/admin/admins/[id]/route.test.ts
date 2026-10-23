import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), origin: vi.fn(), directory: vi.fn(), updateUser: vi.fn(), from: vi.fn(), audit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireSuperAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/admins", async (original) => ({ ...(await original<typeof import("@/lib/admins")>()), loadAdminDirectory: mocks.directory }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ auth: { admin: { updateUserById: mocks.updateUser } }, from: mocks.from }) }));

const selfId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const self = { id: selfId, name: "Current", email: "current@example.com", role: "super_admin", disabled: false, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: null } as const;
const target = { id: targetId, name: "Target", email: "target@example.com", role: "super_admin", disabled: false, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: null } as const;
const context = { params: Promise.resolve({ id: targetId }) };
function request(body: unknown) { return new Request(`http://localhost/api/admin/admins/${targetId}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
function roleUpdate() {
  const chain = { eq: vi.fn(() => chain), select: vi.fn(() => chain), maybeSingle: vi.fn(async () => ({ data: { id: targetId }, error: null })) };
  return { update: vi.fn(() => chain), chain };
}

describe("admin mutation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ id: selfId, name: "Current", role: "super_admin" });
    mocks.directory.mockResolvedValue([self, target]);
    mocks.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    mocks.from.mockImplementation(() => roleUpdate());
    mocks.audit.mockResolvedValue(undefined);
  });

  it("rejects non-super-admin callers", async () => {
    mocks.auth.mockRejectedValue(new AdminAuthError("forbidden", 403));
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "enable" }), context);
    expect(response.status).toBe(403);
    expect(mocks.directory).not.toHaveBeenCalled();
  });

  it("blocks disabling the last enabled super admin before the change", async () => {
    mocks.directory.mockResolvedValue([target]);
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "disable" }), context);
    expect(response.status).toBe(409);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("re-counts after disable and unbans if a race leaves zero super admins", async () => {
    mocks.directory.mockResolvedValueOnce([self, target]).mockResolvedValueOnce([{ ...self, disabled: true }, { ...target, disabled: true }]);
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "disable" }), context);
    expect(response.status).toBe(409);
    expect(mocks.updateUser).toHaveBeenNthCalledWith(1, targetId, { ban_duration: "876000h" });
    expect(mocks.updateUser).toHaveBeenNthCalledWith(2, targetId, { ban_duration: "none" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("disables through a Supabase ban and writes the matching audit action", async () => {
    mocks.directory.mockResolvedValueOnce([self, target]).mockResolvedValueOnce([self, { ...target, disabled: true }]);
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "disable" }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith(targetId, { ban_duration: "876000h" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin_disable", targetId);
  });

  it("re-counts after demotion and restores the role if zero super admins remain", async () => {
    mocks.directory.mockResolvedValueOnce([self, target]).mockResolvedValueOnce([{ ...self, disabled: true }, { ...target, role: "admin" }]);
    const first = roleUpdate(); const revert = roleUpdate();
    mocks.from.mockReturnValueOnce(first).mockReturnValueOnce(revert);
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "role", role: "admin" }), context);
    expect(response.status).toBe(409);
    expect(first.update).toHaveBeenCalledWith({ role: "admin" });
    expect(revert.update).toHaveBeenCalledWith({ role: "super_admin" });
  });

  it("changes role and audits only old and new roles", async () => {
    const promoted = { ...target, role: "admin" as const };
    mocks.directory.mockResolvedValueOnce([self, target]).mockResolvedValueOnce([self, promoted]);
    const update = roleUpdate(); mocks.from.mockReturnValueOnce(update);
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "role", role: "admin" }), context);
    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin_role_change", targetId, { old_role: "super_admin", new_role: "admin" });
  });

  it("cannot disable or demote the signed-in super admin", async () => {
    const selfContext = { params: Promise.resolve({ id: selfId }) };
    const { PATCH } = await import("./route");
    expect((await PATCH(new Request(`http://localhost/api/admin/admins/${selfId}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ action: "disable" }) }), selfContext)).status).toBe(409);
    expect((await PATCH(new Request(`http://localhost/api/admin/admins/${selfId}`, { method: "PATCH", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ action: "role", role: "admin" }) }), selfContext)).status).toBe(409);
  });

  it("resets a password without putting it in the audit record", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "reset_password", password: "new-password-12" }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith(targetId, { password: "new-password-12" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin_password_reset", targetId);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("new-password-12");
  });

  it("enables a disabled admin through Supabase ban removal", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(request({ action: "enable" }), context);
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith(targetId, { ban_duration: "none" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin_enable", targetId);
  });
});
