import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulerLogger } from "./logger";

export type ProctoringRpcClient = Pick<SupabaseClient, "rpc">;

const reminderMs = 5 * 60_000;
const failures = new WeakMap<SchedulerLogger, Map<string, { code: string; at: number }>>();

function state(logger: SchedulerLogger) {
  let current = failures.get(logger);
  if (!current) { current = new Map(); failures.set(logger, current); }
  return current;
}

export async function runProctoringPasses(client: ProctoringRpcClient, logger: SchedulerLogger, now = new Date()): Promise<void> {
  const passes = ["record_disconnects", "resolve_disconnects", "reverse_recent_disconnects"] as const;
  for (const pass of passes) {
    const key = `proctoring:${pass}`;
    try {
      const { data, error } = await client.rpc(pass);
      if (error) throw error;
      if (state(logger).delete(key)) logger.info("proctoring_pass_recovered", { result: pass });
      const changed = typeof data === "number" ? data : 0;
      if (changed > 0) logger.info("proctoring_changed", { result: pass, changed });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "database_error";
      const previous = state(logger).get(key);
      if (!previous || previous.code !== code || now.getTime() - previous.at >= reminderMs) {
        logger.error("proctoring_pass_failed", { result: pass, error_code: code });
        state(logger).set(key, { code, at: now.getTime() });
      }
    }
  }
}
