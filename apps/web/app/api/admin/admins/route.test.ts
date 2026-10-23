import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), origin: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(), from: vi.fn(), audit: vi.fn(), directory: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireSuperAdmin: mocks.auth }));
vi.mock("@/lib/origin", async (original) => ({ ...(await original<typeof import("@/lib/origin")>()), assertSameOrigin: mocks.origin }));
vi.mock("@/lib/admin-server", async (original) => ({ ...(await original<typeof import("@/lib/admin-server")>()), recordAdminAction: mocks.audit }));
vi.mock("@/lib/admins", async (original) => ({ ...(await original<typeof import("@/lib/admins")>()), loadAdminDirectory: mocks.directory }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => ({ auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } }, from: mocks.from }) }));

const user = { id: "00000000-0000-4000-8000-000000000010", email: "new@example.com", created_at: "2026-10-23T00:00:00Z" };
function request(password = "valid-pass-12") {
  return new Request("http://localhost/api/admin/admins", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ name: "New Admin", email: user.email, role: "admin", password }) });
}

describe("admin collection route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ id: "super-id", name: "Super", role: "super_admin" });
    mocks.createUser.mockResolvedValue({ data: { user }, error: null });
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
    mocks.from.mockReturnValue({ insert: vi.fn(async () => ({ error: null })) });
    mocks.audit.mockResolvedValue(undefined);
    mocks.directory.mockResolvedValue([]);
  });

  it("requires a super admin", async () => {
    mocks.auth.mockRejectedValue(new AdminAuthError("forbidden", 403));
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("lists only the safe directory fields returned by the server helper", async () => {
    mocks.directory.mockResolvedValue([{ id: user.id, name: "New Admin", email: user.email, role: "admin", disabled: false, created_at: user.created_at, last_sign_in_at: null }]);
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.items[0]).toEqual({ id: user.id, name: "New Admin", email: user.email, role: "admin", disabled: false, created_at: user.created_at, last_sign_in_at: null });
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("creates a confirmed Auth user and profile without auditing the password", async () => {
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith({ email: user.email, password: "valid-pass-12", email_confirm: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), "admin_create", user.id, { role: "admin" });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("valid-pass-12");
    expect(await response.json()).not.toHaveProperty("password");
  });

  it("returns a duplicate-email conflict", async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", message: "exists" } });
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(409);
  });

  it("deletes the Auth user if profile creation fails", async () => {
    mocks.from.mockReturnValue({ insert: vi.fn(async () => ({ error: { message: "synthetic" } })) });
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.deleteUser).toHaveBeenCalledWith(user.id);
  });
});
