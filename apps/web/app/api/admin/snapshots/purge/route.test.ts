import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  origin: vi.fn(),
  auth: vi.fn(),
  service: vi.fn(),
  purge: vi.fn(),
  audit: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/origin", async (original) => ({
  ...(await original<typeof import("@/lib/origin")>()),
  assertSameOrigin: mocks.origin,
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireSuperAdmin: mocks.auth,
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/admin-server", () => ({ recordAdminAction: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/snapshot-purge", async (original) => ({
  ...(await original<typeof import("@/lib/snapshot-purge")>()),
  runSnapshotPurge: mocks.purge,
}));

const examId = "00000000-0000-4000-8000-000000000001";
function request(body: unknown) {
  return new Request("http://localhost/api/admin/snapshots/purge", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/snapshots/purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SNAPSHOT_RETENTION_DAYS = "14";
    mocks.auth.mockResolvedValue({ id: "admin-1", role: "super_admin" });
    mocks.service.mockReturnValue({ name: "service-client" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.purge.mockResolvedValue({ eligible: 3, deleted: 2, failed: 0, remaining: 1, dry_run: false, invalid: 0 });
  });

  it("checks origin, super-admin auth and strict body in order, then audits counts only", async () => {
    const { POST, maxDuration } = await import("./route");
    const response = await POST(request({ exam_id: examId, dry_run: false, confirm: true }));

    expect(maxDuration).toBe(30);
    expect(response.status).toBe(200);
    expect(mocks.origin.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.purge.mock.invocationCallOrder[0]!);
    expect(mocks.purge).toHaveBeenCalledWith(expect.objectContaining({
      client: { name: "service-client" },
      dryRun: false,
      examId,
      retentionDays: "14",
    }));
    expect(mocks.audit).toHaveBeenCalledWith(
      { name: "service-client" },
      expect.objectContaining({ id: "admin-1" }),
      "snapshot_purge",
      examId,
      { eligible: 3, deleted: 2, failed: 0, remaining: 1 },
    );
    expect(await response.json()).toEqual({ eligible: 3, deleted: 2, failed: 0, remaining: 1, dry_run: false });
  });

  it("dry-runs without confirmation or an audit row", async () => {
    mocks.purge.mockResolvedValue({ eligible: 4, deleted: 0, failed: 0, remaining: 4, dry_run: true, invalid: 0 });
    const { POST } = await import("./route");
    const response = await POST(request({ dry_run: true }));
    expect(response.status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ eligible: 4, dry_run: true });
  });

  it("rejects unknown keys and missing mutation confirmation before orchestration", async () => {
    const { POST } = await import("./route");
    for (const body of [
      { dry_run: true, older_than_days: 0 },
      { dry_run: false },
      { dry_run: false, confirm: false },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.purge).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns safe 503 when exact retention is not configured", async () => {
    const { SnapshotPurgeConfigurationError } = await import("@/lib/snapshot-purge");
    mocks.purge.mockRejectedValue(new SnapshotPurgeConfigurationError());
    const { POST } = await import("./route");
    const response = await POST(request({ dry_run: true }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "service_unavailable", message: "Snapshot cleanup is unavailable.", details: null } });
  });

  it("logs only an invalid-path count", async () => {
    const { POST } = await import("./route");
    await POST(request({ dry_run: false, confirm: true }));
    const callback = mocks.purge.mock.calls[0]![0].onInvalidPaths as (count: number) => void;
    callback(2);
    expect(mocks.warn).toHaveBeenCalledWith("snapshot_purge_invalid_paths", { itemCount: 2 });
  });
});
