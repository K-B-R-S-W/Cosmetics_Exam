import { createClient } from "@supabase/supabase-js";

import { loadWorkerConfig, SCHEDULER_INTERVAL_MS } from "./config";
import { schedulerLogger } from "./logger";
import { runSchedulerTick } from "./scheduler";
import { createSchedulerSource } from "./supabase-source";

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  if (process.env.WORKER_SELF_TEST === "1") {
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

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick(dependencies);
    } finally {
      running = false;
    }
  };

  await tick();
  const timer = setInterval(() => void tick(), SCHEDULER_INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch(() => {
  console.error(JSON.stringify({
    level: "error",
    event: "worker_fatal",
    time: new Date().toISOString(),
    error_code: "worker_fatal",
  }));
  process.exit(1);
});
