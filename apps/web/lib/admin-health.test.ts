import { describe, expect, it } from "vitest";
import { WORKER_STALE_MS, workerHealth } from "./admin-health";

describe("workerHealth", () => {
  it("uses the inclusive 90-second freshness boundary", () => {
    const now = Date.now();
    expect(workerHealth({ status: "ok", last_heartbeat_at: new Date(now - WORKER_STALE_MS).toISOString() }, now).ok).toBe(true);
    expect(workerHealth({ status: "ok", last_heartbeat_at: new Date(now - WORKER_STALE_MS - 1).toISOString() }, now).ok).toBe(false);
    expect(workerHealth({ status: "down", last_heartbeat_at: new Date(now).toISOString() }, now).ok).toBe(false);
  });
});
