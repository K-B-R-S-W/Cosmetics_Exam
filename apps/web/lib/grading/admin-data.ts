import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";

export async function loadGradingProgress(client: SupabaseClient, examId: string) {
  const [runs, jobs, keys, logs, attempts, health] = await Promise.all([
    client.from("grading_runs").select("id,kind,status,pause_reason,resume_at,started_at,finished_at").eq("exam_id", examId).order("started_at", { ascending: false }),
    client.from("grading_jobs").select("id,run_id,status,tries,error,created_at,finished_at,grading_runs!inner(exam_id)").eq("grading_runs.exam_id", examId),
    client.from("api_key_state").select("label,status,cooldown_until,updated_at").order("label"),
    client.from("grading_log").select("id,run_id,job_id,key_label,model,event,detail,at,grading_runs!inner(exam_id)").eq("grading_runs.exam_id", examId).order("at", { ascending: false }).limit(50),
    client.from("attempts").select("id,status").eq("exam_id", examId),
    client.from("system_health").select("component,status,last_heartbeat_at,detail").eq("component", "worker").maybeSingle(),
  ]);
  const failure = [runs, jobs, keys, logs, attempts, health].find((result) => result.error)?.error;
  if (failure) throw new ApiError("service_unavailable", 503, "Grading status is unavailable.");
  const queue = (jobs.data ?? []).reduce<Record<string, number>>((out, job) => { out[job.status] = (out[job.status] ?? 0) + 1; return out; }, {});
  const attemptIds = (attempts.data ?? []).map((attempt) => attempt.id);
  const [paperRows, scoreRows] = attemptIds.length ? await Promise.all([
    client.from("attempt_questions").select("attempt_id,question_id").in("attempt_id", attemptIds),
    client.from("current_scores").select("attempt_id,question_id").in("attempt_id", attemptIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (paperRows.error || scoreRows.error) throw new ApiError("service_unavailable", 503, "Grading status is unavailable.");
  const scored = new Set((scoreRows.data ?? []).map((row) => `${row.attempt_id}:${row.question_id}`));
  const slots = safeWorkerSlots(health.data?.detail ?? null);
  return {
    runs: runs.data ?? [], queue,
    keys: (keys.data ?? []).map((key) => { const slot = slots.find((item) => item.key === key.label); return { label: key.label, status: key.status, cooldown_until: key.cooldown_until, updated_at: key.updated_at, used: slot?.used ?? null, limit: slot?.limit ?? null }; }),
    logs: (logs.data ?? []).map((log) => ({ id: log.id, run_id: log.run_id, job_id: log.job_id, key_label: log.key_label, model: log.model, event: log.event, detail: safeGradingLogDetail(log.detail), at: log.at })),
    not_graded: (paperRows.data ?? []).filter((row) => !scored.has(`${row.attempt_id}:${row.question_id}`)).length,
  };
}

function safeWorkerSlots(detail: string | null): Array<{ key: string; used: number; limit: number }> {
  try {
    const parsed: unknown = JSON.parse(detail ?? "null");
    if (!parsed || typeof parsed !== "object" || !("slots" in parsed) || !Array.isArray(parsed.slots)) return [];
    return parsed.slots.flatMap((slot) => {
      if (!slot || typeof slot !== "object") return [];
      const value = slot as Record<string, unknown>;
      return typeof value.key === "string" && typeof value.used === "number" && Number.isFinite(value.used) && typeof value.limit === "number" && Number.isFinite(value.limit)
        ? [{ key: value.key, used: Number(value.used), limit: Number(value.limit) }] : [];
    }).filter((slot) => /^key[1-3]$/u.test(slot.key));
  } catch { return []; }
}

export function safeGradingLogDetail(detail: string | null): string | null {
  if (!detail) return null;
  return /^(?:[a-z_]+=[a-z0-9_.:+-]+)(?:,[a-z_]+=[a-z0-9_.:+-]+)*$/iu.test(detail) ? detail : null;
}
