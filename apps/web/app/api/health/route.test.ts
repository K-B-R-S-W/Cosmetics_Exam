import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { GET } from "./route";

function mockHealthQuery(error: unknown) {
  const limit = vi.fn().mockResolvedValue({ error });
  const select = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ select });

  mocks.createServiceRoleClient.mockReturnValue({ from });

  return { from, select, limit };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns the public success shape after the system_health query succeeds", async () => {
    const query = mockHealthQuery(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(query.from).toHaveBeenCalledWith("system_health");
    expect(query.select).toHaveBeenCalledWith("component");
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("returns no internal detail when Supabase fails", async () => {
    mockHealthQuery({ code: "42501", message: "sensitive detail" });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false });
  });
});
