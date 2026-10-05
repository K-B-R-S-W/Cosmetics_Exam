import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  HEALTH_HEARTBEAT_INTERVAL_MS,
  loadWorkerConfig,
  PROCTORING_INTERVAL_MS,
  SCHEDULER_INTERVAL_MS,
} from "./config";
import {
  acquireWorkerOwnership,
  createHeartbeatRunner,
  createWorkerHealthStore,
  WORKER_VERSION,
  type WorkerActivity,
  type WorkerHealthStore,
} from "./health";
import { schedulerLogger } from "./logger";
import { runProctoringPasses } from "./proctoring";
import { runSchedulerTick } from "./scheduler";
import { createSchedulerSource } from "./supabase-source";

export type WorkerLaneController = {
  stop(): void;
  waitForHeartbeat(timeoutMs?: number): Promise<void>;
};

export function startWorkerLanes(
  lifecycleTick: () => Promise<void>,
  proctoringTick: () => Promise<void>,
  heartbeatTick: () => Promise<unknown>,
  options: { runHeartbeatImmediately?: boolean } = {},
): WorkerLaneController {
  let lifecycleRunning = false;
  let proctoringRunning = false;
  let heartbeatRunning: Promise<unknown> | null = null;
  const lifecycle = async () => {
    if (lifecycleRunning) return;
    lifecycleRunning = true;
    try { await lifecycleTick(); } finally { lifecycleRunning = false; }
  };
  const proctoring = async () => {
    if (proctoringRunning) return;
    proctoringRunning = true;
    try { await proctoringTick(); } finally { proctoringRunning = false; }
  };
  const heartbeat = () => {
    if (heartbeatRunning) return;
    heartbeatRunning = heartbeatTick().finally(() => { heartbeatRunning = null; });
  };
  void lifecycle();
  void proctoring();
  if (options.runHeartbeatImmediately) heartbeat();
  const lifecycleTimer = setInterval(() => void lifecycle(), SCHEDULER_INTERVAL_MS);
  const proctoringTimer = setInterval(() => void proctoring(), PROCTORING_INTERVAL_MS);
  const heartbeatTimer = setInterval(heartbeat, HEALTH_HEARTBEAT_INTERVAL_MS);
  return {
    stop() {
      clearInterval(lifecycleTimer);
      clearInterval(proctoringTimer);
      clearInterval(heartbeatTimer);
    },
    async waitForHeartbeat(timeoutMs = 3_000) {
      if (!heartbeatRunning) return;
      await Promise.race([
        heartbeatRunning.then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}

type ShutdownOptions = {
  instance: string;
  store: WorkerHealthStore;
  getLanes: () => WorkerLaneController | null;
  ownsRow: () => boolean;
  setStopping: () => void;
  exit: (code: number) => void;
};

export function createShutdownHandler(options: ShutdownOptions): () => Promise<void> {
  let shutdown: Promise<void> | null = null;
  return () => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      options.setStopping();
      const lanes = options.getLanes();
      lanes?.stop();
      await lanes?.waitForHeartbeat(3_000);
      if (options.ownsRow()) {
        try {
          await options.store.markDown(options.instance);
        } catch {
          schedulerLogger.error("worker_shutdown_health_failed", { error_code: "database_error" });
        }
      }
      options.exit(0);
    })();
    return shutdown;
  };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  if (process.env.WORKER_SELF_TEST === "1") {
    let lifecycleRuns = 0;
    let proctoringRuns = 0;
    let healthRuns = 0;
    const lanes = startWorkerLanes(
      async () => { lifecycleRuns += 1; },
      async () => { proctoringRuns += 1; },
      async () => { healthRuns += 1; },
      { runHeartbeatImmediately: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    lanes.stop();
    if (lifecycleRuns !== 1 || proctoringRuns !== 1 || healthRuns !== 1) {
      throw new Error("worker_lane_self_test_failed");
    }
    console.info("WORKER DIST THREE-LANE SELF-TEST PASSED");
    console.info("WORKER DIST SELF-TEST PASSED");
    return;
  }

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const store = createWorkerHealthStore(client);
  const instance = randomUUID();
  const startedAt = new Date().toISOString();
  const activity: WorkerActivity = { lastLifecycleTickAt: null, lastProctoringTickAt: null };
  let stopping = false;
  let ownsRow = false;
  let lanes: WorkerLaneController | null = null;
  const shutdown = createShutdownHandler({
    instance,
    store,
    getLanes: () => lanes,
    ownsRow: () => ownsRow,
    setStopping: () => { stopping = true; },
    exit: (code) => process.exit(code),
  });
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  const identity = { instance, version: WORKER_VERSION, startedAt };
  const guard = await acquireWorkerOwnership({
    store,
    identity,
    activity,
    logger: schedulerLogger,
    isStopping: () => stopping,
  });
  if (guard === "stopped") return;
  if (guard === "guard_exit") {
    stopping = true;
    process.exit(3);
    return;
  }
  ownsRow = true;

  const dependencies = {
    source: createSchedulerSource(client),
    rpcClient: client,
    logger: schedulerLogger,
    now: () => new Date(),
  };
  const guardExit = () => {
    if (stopping) return;
    stopping = true;
    ownsRow = false;
    lanes?.stop();
    process.exit(3);
  };
  const heartbeat = createHeartbeatRunner({
    store,
    identity,
    activity,
    logger: schedulerLogger,
    isStopping: () => stopping,
    onGuardExit: guardExit,
  });

  lanes = startWorkerLanes(
    async () => {
      await runSchedulerTick(dependencies);
      activity.lastLifecycleTickAt = new Date().toISOString();
    },
    async () => {
      await runProctoringPasses(client, schedulerLogger);
      activity.lastProctoringTickAt = new Date().toISOString();
    },
    heartbeat,
  );
}

if (!process.env.VITEST) main().catch(() => {
  console.error(JSON.stringify({
    level: "error",
    event: "worker_fatal",
    time: new Date().toISOString(),
    error_code: "worker_fatal",
  }));
  process.exit(1);
});
