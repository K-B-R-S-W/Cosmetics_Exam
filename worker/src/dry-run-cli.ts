import { createClient } from "@supabase/supabase-js";
import { loadWorkerConfig } from "./config";
import { runDryRun } from "./dry-run";
import { createGradingRepository } from "./grader";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const result = await runDryRun(config.grading, createGradingRepository(client));
  console.info(JSON.stringify({ event: "grading_dry_run_complete", results: result }));
}

if (!process.env.VITEST) void main().catch(() => {
  console.error(JSON.stringify({ level: "error", event: "grading_dry_run_failed", error_code: "dry_run_failed" }));
  process.exit(1);
});
