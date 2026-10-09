import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SnapshotPurgeConfigurationError,
  SnapshotPurgeOperationError,
  runSnapshotPurge,
} from "../../apps/web/lib/snapshot-purge";
import { SNAPSHOT_PURGE_INTERVAL_MS } from "./config";
import type { SchedulerLogger } from "./logger";

type PurgeFunction = typeof runSnapshotPurge;
type TickResult = "continue" | "disable";

export type SnapshotPurgeLane = {
  stop(): void;
  tickNow(): Promise<void>;
};

function safeErrorCode(error: unknown): string {
  if (error instanceof SnapshotPurgeOperationError) return error.operation;
  return "snapshot_purge_failed";
}

export function createSnapshotPurgeTick({
  client,
  retentionDays,
  logger,
  purge = runSnapshotPurge,
}: {
  client: SupabaseClient;
  retentionDays: string | undefined;
  logger: SchedulerLogger;
  purge?: PurgeFunction;
}): () => Promise<TickResult> {
  let failureFingerprint: string | null = null;
  return async () => {
    try {
      const result = await purge({
        client,
        dryRun: false,
        retentionDays,
      });
      const counts = {
        eligible: result.eligible,
        deleted: result.deleted,
        failed: result.failed,
        remaining: result.remaining,
      };

      if (result.failed > 0) {
        const nextFingerprint = `partial:${result.failed}:${result.remaining}`;
        if (result.deleted > 0 || failureFingerprint !== nextFingerprint) {
          logger.error("snapshot_purge_incomplete", counts);
        }
        failureFingerprint = nextFingerprint;
      } else {
        if (failureFingerprint) logger.info("snapshot_purge_recovered", {});
        failureFingerprint = null;
        if (result.deleted > 0) logger.info("snapshot_purge_completed", counts);
      }
      return "continue";
    } catch (error) {
      if (error instanceof SnapshotPurgeConfigurationError) {
        if (failureFingerprint !== "invalid_retention") {
          logger.error("snapshot_purge_disabled", { error_code: "invalid_retention" });
          failureFingerprint = "invalid_retention";
        }
        return "disable";
      }
      const code = safeErrorCode(error);
      const nextFingerprint = `error:${code}`;
      if (failureFingerprint !== nextFingerprint) {
        logger.error("snapshot_purge_failed", { error_code: code });
        failureFingerprint = nextFingerprint;
      }
      return "continue";
    }
  };
}

export function startSnapshotPurgeLane(
  tick: () => Promise<TickResult>,
  intervalMs = SNAPSHOT_PURGE_INTERVAL_MS,
): SnapshotPurgeLane {
  let stopped = false;
  let disabled = false;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = (): Promise<void> => {
    if (stopped || disabled) return Promise.resolve();
    if (running) return running;
    running = tick()
      .then((result) => {
        if (result === "disable") {
          disabled = true;
          if (timer) clearInterval(timer);
        }
      })
      .finally(() => { running = null; });
    return running;
  };

  void run();
  timer = setInterval(() => void run(), intervalMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    tickNow: run,
  };
}
