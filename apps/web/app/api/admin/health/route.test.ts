import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn(), livekit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireSuperAdmin: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.service }));
vi.mock("@/lib/livekit-server", async (original) => ({ ...(await original<typeof import("@/lib/livekit-server")>()), checkLiveKitHealth: mocks.livekit }));

describe("GET /api/admin/health", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin", role: "super_admin" }); });

  it("returns component latency, worker age, keys and active alerts", async () => {
    const responses = new Map([
      ["system_health", { data: { component: "worker", status: "ok", last_heartbeat_at: new Date(Date.now() - 10_000).toISOString() }, error: null }],
      ["api_key_state", { data: [{ label: "key1", status: "active", cooldown_until: null, last_error: null, updated_at: new Date().toISOString() }], error: null }],
      ["alerts", { data: [{ id: "alert", type: "worker", severity: "warning", message: "Check worker", created_at: new Date().toISOString(), resolved_at: null }], error: null }],
    ]);
    mocks.service.mockReturnValue({ from: (table: string) => ({ select: () => table === "system_health"
      ? { eq: () => ({ maybeSingle: async () => responses.get(table) }) }
      : table === "alerts"
        ? { is: () => ({ order: async () => responses.get(table) }) }
        : { order: async () => responses.get(table) } }) });
    mocks.livekit.mockResolvedValue({ ok: true, latency_ms: 8, room_count: 1 });
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.components.worker.ok).toBe(true);
    expect(body.components.livekit.room_count).toBe(1);
    expect(body.keys).toHaveLength(1);
    expect(body.alerts).toHaveLength(1);
  });

  it("returns 503 when the worker heartbeat is older than 90 seconds", async () => {
    const old = new Date(Date.now() - 91_000).toISOString();
    mocks.service.mockReturnValue({ from: (table: string) => ({ select: () => table === "system_health"
      ? { eq: () => ({ maybeSingle: async () => ({ data: { component: "worker", status: "ok", last_heartbeat_at: old }, error: null }) }) }
      : table === "alerts"
        ? { is: () => ({ order: async () => ({ data: [], error: null }) }) }
        : { order: async () => ({ data: [], error: null }) } }) });
    mocks.livekit.mockResolvedValue({ ok: true, latency_ms: 8, room_count: 0 });
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(503);
  });

  it("returns a safe 503 component body instead of database error text", async () => {
    mocks.service.mockReturnValue({ from: (table: string) => ({ select: () => table === "system_health"
      ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "secret database detail" } }) }) }
      : table === "alerts"
        ? { is: () => ({ order: async () => ({ data: [], error: null }) }) }
        : { order: async () => ({ data: [], error: null }) } }) });
    mocks.livekit.mockResolvedValue({ ok: true, latency_ms: 8, room_count: 0 });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toEqual(expect.objectContaining({ error: expect.anything() }));
  });
});
