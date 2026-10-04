import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CandidateAuthContext } from "@/lib/candidate-session";
import type { ExamPhase, StateBody } from "@/lib/candidate-types";
import { createServiceRoleClient } from "@/lib/supabase/server";

type ExamStateRow = {
  id: string;
  title: string;
  status: StateBody["exam"]["status"];
  navigation_mode: StateBody["exam"]["navigation_mode"];
  scheduled_start_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  force_ended_at: string | null;
  questions: Array<{ count: number }> | { count: number } | null;
};

export function attemptDeadline(endsAt: string | null, extraMinutes: number): string | null {
  if (!endsAt) return null;
  return new Date(new Date(endsAt).getTime() + extraMinutes * 60_000).toISOString();
}

export function examPhase(
  attemptStatus: StateBody["attempt"]["status"],
  examStatus: StateBody["exam"]["status"],
  forceEnded: boolean,
  deadline: string | null,
  now: Date,
): ExamPhase {
  if (attemptStatus === "submitted" || attemptStatus === "finalized") return "submitted";
  if (
    examStatus === "live" &&
    !forceEnded &&
    deadline !== null &&
    now.getTime() <= new Date(deadline).getTime()
  ) return "live";
  if (examStatus === "draft" || examStatus === "scheduled") return "waiting";
  return "closed";
}

export async function buildStateBody(
  auth: CandidateAuthContext,
  options: { supabase?: SupabaseClient; now?: Date } = {},
): Promise<StateBody> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const now = options.now ?? new Date();
  const { data, error } = await supabase
    .from("exams")
    .select("id,title,status,navigation_mode,scheduled_start_at,started_at,ends_at,force_ended_at,questions(count)")
    .eq("id", auth.examId)
    .single();
  if (error) throw error;
  const exam = data as ExamStateRow;
  const deadline = attemptDeadline(exam.ends_at, auth.extraMinutes ?? 0);
  const forceEnded = exam.force_ended_at !== null;
  const questions = Array.isArray(exam.questions) ? exam.questions[0] : exam.questions;

  return {
    server_time: now.toISOString(),
    phase: examPhase(auth.attemptStatus, exam.status, forceEnded, deadline, now),
    exam: {
      id: exam.id,
      title: exam.title,
      status: exam.status,
      navigation_mode: exam.navigation_mode,
      scheduled_start_at: exam.scheduled_start_at,
      started_at: exam.started_at,
      ends_at: exam.ends_at,
      force_ended: forceEnded,
      question_count: questions?.count ?? 0,
    },
    attempt: {
      id: auth.attemptId,
      status: auth.attemptStatus,
      current_position: auth.currentPosition ?? 0,
      extra_minutes: auth.extraMinutes ?? 0,
      deadline,
      submit_reason: auth.submitReason ?? null,
    },
    // Task 5A.5 adds durable announcement claims. Keep the response shape now.
    announcements: [],
  };
}
