import { describe, expect, it } from "vitest";

import { SCHEDULER_EARLY_WINDOW_MS, SCHEDULER_INTERVAL_MS, loadWorkerConfig } from "./config";

describe("worker config", () => {
  it("uses the approved scheduler cadence and conservative scan window", () => {
    expect(SCHEDULER_INTERVAL_MS).toBe(10_000);
    expect(SCHEDULER_EARLY_WINDOW_MS).toBe(60_000);
  });

  it("accepts the scheduler's complete environment", () => {
    expect(loadWorkerConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    })).toEqual({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "synthetic-service-key",
    });
  });

  it("fails closed when either secret is missing", () => {
    expect(() => loadWorkerConfig({ SUPABASE_URL: "https://example.supabase.co" })).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(() => loadWorkerConfig({ SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" })).toThrow(
      "SUPABASE_URL",
    );
  });
});
