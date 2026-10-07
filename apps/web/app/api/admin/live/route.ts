import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import type { LiveAttempt, LiveExam, LiveProgress } from "@/lib/admin-live";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/live";
const EXAM_COLUMNS = "id,title,status,navigation_mode,scheduled_start_at,started_at,ends_at,force_ended_at,duration_min,flag_threshold";
const ATTEMPT_COLUMNS = "id,status,current_position,extra_minutes,last_seen_at,violation_count,submitted_at,candidates!inner(id,mer_code,full_name,outlet)";
const PROGRESS_COLUMNS = "attempt_id,status,current_position,total_questions,answered_count,flagged_count";
const querySchema = z.object({ exam: z.string().uuid().optional(), view: z.enum(["full", "progress"]).default("full") }).strict();

function candidateOf(value: unknown): LiveAttempt["candidate"] | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? row as LiveAttempt["candidate"] : null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(url.searchParams));
    const client = createServiceRoleClient();

    if (input.view === "progress") {
      if (!input.exam) throw new ApiError("validation_failed", 400, "Choose an exam.");
      const { data, error } = await client.from("attempt_progress").select(PROGRESS_COLUMNS).eq("exam_id", input.exam);
      if (error) throw new Error("live_progress_load_failed");
      return jsonResponse({ server_time: new Date().toISOString(), progress: (data ?? []) as LiveProgress[] });
    }

    const { data: examRows, error: examsError } = await client.from("exams").select(EXAM_COLUMNS).in("status", ["scheduled", "live", "ended", "finalized"]).order("scheduled_start_at", { ascending: true, nullsFirst: false });
    if (examsError) throw new Error("live_exams_load_failed");
    const exams = (examRows ?? []) as LiveExam[];
    const exam = input.exam
      ? exams.find((item) => item.id === input.exam) ?? null
      : exams.find((item) => item.status === "live") ?? exams.find((item) => item.status === "scheduled") ?? null;
    if (input.exam && !exam) throw new ApiError("not_found", 404, "Exam not found.");
    if (!exam) return jsonResponse({ server_time: new Date().toISOString(), exams, exam: null, attempts: [], progress: [] });

    const [{ data: attemptRows, error: attemptsError }, { data: progressRows, error: progressError }] = await Promise.all([
      client.from("attempts").select(ATTEMPT_COLUMNS).eq("exam_id", exam.id),
      client.from("attempt_progress").select(PROGRESS_COLUMNS).eq("exam_id", exam.id),
    ]);
    if (attemptsError || progressError) throw new Error("live_grid_load_failed");
    const attempts = (attemptRows ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      const candidate = candidateOf(record.candidates);
      if (!candidate) throw new Error("live_candidate_missing");
      return { ...record, candidates: undefined, candidate } as unknown as LiveAttempt;
    });
    return jsonResponse({ server_time: new Date().toISOString(), exams, exam, attempts, progress: (progressRows ?? []) as LiveProgress[] });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
