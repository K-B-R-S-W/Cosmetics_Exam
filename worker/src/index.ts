import { createClient } from "@supabase/supabase-js";

import { loadWorkerConfig, PROCTORING_INTERVAL_MS, SCHEDULER_INTERVAL_MS } from "./config";
import { schedulerLogger } from "./logger";
import { runProctoringPasses } from "./proctoring";
import { runSchedulerTick } from "./scheduler";
import { createSchedulerSource } from "./supabase-source";

export function startWorkerLanes(
  lifecycleTick: () => Promise<void>,
  proctoringTick: () => Promise<void>,
): () => void {
  let lifecycleRunning = false;
  let proctoringRunning = false;
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
  void lifecycle();
  void proctoring();
  const lifecycleTimer = setInterval(() => void lifecycle(), SCHEDULER_INTERVAL_MS);
  const proctoringTimer = setInterval(() => void proctoring(), PROCTORING_INTERVAL_MS);
  return () => { clearInterval(lifecycleTimer); clearInterval(proctoringTimer); };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  if (process.env.WORKER_SELF_TEST === "1") {
    let lifecycleRuns = 0;
    let proctoringRuns = 0;
    const stop = startWorkerLanes(
      async () => { lifecycleRuns += 1; },
      async () => { proctoringRuns += 1; },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    if (lifecycleRuns !== 1 || proctoringRuns !== 1) throw new Error("worker_lane_self_test_failed");
    console.info("WORKER DIST SELF-TEST PASSED");
    return;
  }

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const dependencies = {
    source: createSchedulerSource(client),
    rpcClient: client,
    logger: schedulerLogger,
    now: () => new Date(),
  };

  const stopLanes = startWorkerLanes(
    () => runSchedulerTick(dependencies),
    () => runProctoringPasses(client, schedulerLogger),
  );
  const stop = () => {
    stopLanes();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
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
