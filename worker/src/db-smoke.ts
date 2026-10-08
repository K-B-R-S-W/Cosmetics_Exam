import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Probe = { name: string; run(client: SupabaseClient): PromiseLike<{ error: { code?: string } | null }> };

export const WORKER_READ_PROBES: Probe[] = [
  { name: "pending_jobs", run: (client) => client.from("grading_jobs").select("id,run_id,attempt_id,chunk_index,question_ids,tries,grading_runs!inner(status)").limit(1) },
  { name: "attempt_questions", run: (client) => client.from("attempt_questions").select("question_id").limit(1) },
  { name: "questions", run: (client) => client.from("questions").select("id,body_html,marks,image_path,image_alt_text").limit(1) },
  { name: "answer_keys", run: (client) => client.from("answer_keys").select("question_id,model_answer,grading_notes,calibration").limit(1) },
  { name: "answers", run: (client) => client.from("answers").select("question_id,answer_text").limit(1) },
  { name: "job_chunk_index", run: (client) => client.from("grading_jobs").select("chunk_index").limit(1) },
  { name: "paused_runs", run: (client) => client.from("grading_runs").select("id").limit(1) },
  { name: "running_runs", run: (client) => client.from("grading_runs").select("id,grading_jobs(status)").limit(1) },
  { name: "grading_log", run: (client) => client.from("grading_log").select("key_label").limit(1) },
  { name: "grading_job_ids", run: (client) => client.from("grading_jobs").select("id").limit(1) },
  { name: "grading_job_status", run: (client) => client.from("grading_jobs").select("status").limit(1) },
  { name: "api_key_state", run: (client) => client.from("api_key_state").select("label,status,cooldown_until,updated_at").limit(1) },
  { name: "system_health", run: (client) => client.from("system_health").select("component,status,last_heartbeat_at,detail").limit(1) },
  { name: "scheduled_exams", run: (client) => client.from("exams").select("id").limit(1) },
  { name: "due_attempts", run: (client) => client.from("attempts").select("id,exam_id,status,extra_minutes,exams!inner(status,ends_at,force_ended_at)").limit(1) },
  { name: "lifecycle_exams", run: (client) => client.from("exams").select("id,status,ends_at,force_ended_at,attempts(extra_minutes)").limit(1) },
];

export async function runDatabaseSmoke(client: SupabaseClient, write: (line: string) => void = console.info): Promise<boolean> {
  let ok = true;
  for (const probe of WORKER_READ_PROBES) {
    const result = await probe.run(client);
    if (result.error) {
      ok = false;
      write(`${probe.name}: ERROR ${result.error.code ?? "database_error"}`);
    } else write(`${probe.name}: OK`);
  }
  return ok;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("missing_worker_environment");
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  if (!await runDatabaseSmoke(client)) process.exitCode = 1;
}

if (!process.env.VITEST) main().catch(() => {
  console.error("db-smoke: ERROR db_smoke_failed");
  process.exit(1);
});
