import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SnapshotPurgeConfigurationError,
  SnapshotPurgeOperationError,
  type SnapshotPurgeResult,
} from "../../apps/web/lib/snapshot-purge";
import { SNAPSHOT_PURGE_INTERVAL_MS } from "./config";
import type { SchedulerLogger } from "./logger";
import { createSnapshotPurgeTick, startSnapshotPurgeLane } from "./snapshot-purge";

afterEach(() => vi.useRealTimers());

const idle: SnapshotPurgeResult = {
  eligible: 0,
  deleted: 0,
  failed: 0,
  remaining: 0,
  dry_run: false,
  invalid: 0,
};

function logger(): SchedulerLogger {
  return { info: vi.fn(), error: vi.fn() };
}

function client(): SupabaseClient {
  return {} as SupabaseClient;
}

describe("snapshot purge tick", () => {
  it("passes the exact retention setting to the shared orchestrator and stays silent when idle", async () => {
    const log = logger();
    const purge = vi.fn().mockResolvedValue(idle);
    const tick = createSnapshotPurgeTick({
      client: client(),
      retentionDays: "14",
      logger: log,
      purge,
    });

    await expect(tick()).resolves.toBe("continue");
    expect(purge).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false,
      retentionDays: "14",
    }));
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("disables only this lane and logs invalid retention once", async () => {
    vi.useFakeTimers();
    const log = logger();
    const purge = vi.fn().mockRejectedValue(new SnapshotPurgeConfigurationError());
    const tick = createSnapshotPurgeTick({ client: client(), retentionDays: "0", logger: log, purge });
    const lane = startSnapshotPurgeLane(tick);

    await vi.advanceTimersByTimeAsync(SNAPSHOT_PURGE_INTERVAL_MS * 2);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("snapshot_purge_disabled", {
      error_code: "invalid_retention",
    });
    lane.stop();
  });

  it("logs changed counts only and leaves an idle run silent", async () => {
    const log = logger();
    const purge = vi.fn()
      .mockResolvedValueOnce({ ...idle, eligible: 3, deleted: 2, failed: 1, remaining: 1 })
      .mockResolvedValueOnce(idle);
    const tick = createSnapshotPurgeTick({ client: client(), retentionDays: "14", logger: log, purge });

    await tick();
    await tick();
    expect(log.error).toHaveBeenCalledWith("snapshot_purge_incomplete", {
      eligible: 3,
      deleted: 2,
      failed: 1,
      remaining: 1,
    });
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain("snapshot_path");
  });

  it("deduplicates identical safe errors and logs one recovery", async () => {
    const log = logger();
    const purge = vi.fn()
      .mockRejectedValueOnce(new SnapshotPurgeOperationError("snapshot_purge_claim"))
      .mockRejectedValueOnce(new SnapshotPurgeOperationError("snapshot_purge_claim"))
      .mockResolvedValueOnce(idle);
    const tick = createSnapshotPurgeTick({ client: client(), retentionDays: "14", logger: log, purge });

    await tick();
    await tick();
    await tick();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("snapshot_purge_failed", {
      error_code: "snapshot_purge_claim",
    });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("snapshot_purge_recovered", {});
  });

  it("never places raw errors or secrets in logs", async () => {
    const log = logger();
    const purge = vi.fn().mockRejectedValue(new Error("service-key=secret database row contents"));
    const tick = createSnapshotPurgeTick({ client: client(), retentionDays: "14", logger: log, purge });

    await tick();
    const output = JSON.stringify([
      ...vi.mocked(log.info).mock.calls,
      ...vi.mocked(log.error).mock.calls,
    ]);
    expect(output).not.toContain("service-key");
    expect(output).not.toContain("database row");
    expect(log.error).toHaveBeenCalledWith("snapshot_purge_failed", {
      error_code: "snapshot_purge_failed",
    });
  });
});

describe("snapshot purge lane", () => {
  it("runs at startup and every 24 hours, then stops", async () => {
    vi.useFakeTimers();
    const tick = vi.fn().mockResolvedValue("continue" as const);
    const lane = startSnapshotPurgeLane(tick);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SNAPSHOT_PURGE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    lane.stop();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_PURGE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("does not overlap when a purge is still running", async () => {
    vi.useFakeTimers();
    let finish!: (value: "continue") => void;
    const tick = vi.fn(() => new Promise<"continue">((resolve) => { finish = resolve; }));
    const lane = startSnapshotPurgeLane(tick);
    await vi.advanceTimersByTimeAsync(0);

    const manual = lane.tickNow();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_PURGE_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    finish("continue");
    await manual;
    lane.stop();
  });
});
