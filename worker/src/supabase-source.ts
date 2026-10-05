import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduledExamCandidate = {
  id: string;
};

export type OpenAttemptCandidate = {
  id: string;
  exam_id: string;
  status: "not_started" | "acknowledged" | "in_progress";
  extra_minutes: number;
};

export type LifecycleExamCandidate = {
  id: string;
};

export const SCHEDULER_SCAN_PAGE_SIZE = 500;

export class SchedulerSourceError extends Error {
  readonly code: string;

  constructor(operation: string, code?: string) {
    super(`${operation}_failed`);
    this.name = "SchedulerSourceError";
    this.code = code || "database_error";
  }
}

export interface SchedulerSource {
  listScheduledExams(cutoff: Date): Promise<ScheduledExamCandidate[]>;
  listDueAttempts(cutoff: Date): Promise<OpenAttemptCandidate[]>;
  listLifecycleExams(cutoff: Date): Promise<LifecycleExamCandidate[]>;
}

type EmbeddedExam = {
  status: string;
  ends_at: string | null;
  force_ended_at: string | null;
};

type AttemptScanRow = OpenAttemptCandidate & {
  exams: EmbeddedExam | EmbeddedExam[];
};

type LifecycleScanRow = {
  id: string;
  status: string;
  ends_at: string | null;
  force_ended_at: string | null;
  attempts: Array<{ extra_minutes: number }> | null;
};

function oneExam(value: EmbeddedExam | EmbeddedExam[]): EmbeddedExam | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function atOrBefore(value: string | null, cutoff: Date, extraMinutes = 0): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time + extraMinutes * 60_000 + 15_000 <= cutoff.getTime();
}

export function createSchedulerSource(client: SupabaseClient): SchedulerSource {
  return {
    async listScheduledExams(cutoff) {
      const rows: ScheduledExamCandidate[] = [];
      for (let offset = 0; ; offset += SCHEDULER_SCAN_PAGE_SIZE) {
        const { data, error } = await client
          .from("exams")
          .select("id")
          .eq("status", "scheduled")
          .lte("scheduled_start_at", cutoff.toISOString())
          .order("id")
          .range(offset, offset + SCHEDULER_SCAN_PAGE_SIZE - 1);
        if (error) throw new SchedulerSourceError("scheduled_scan", error.code);
        const page = (data || []) as ScheduledExamCandidate[];
        rows.push(...page);
        if (page.length < SCHEDULER_SCAN_PAGE_SIZE) return rows;
      }
    },

    async listDueAttempts(cutoff) {
      const rows: AttemptScanRow[] = [];
      for (let offset = 0; ; offset += SCHEDULER_SCAN_PAGE_SIZE) {
        const { data, error } = await client
          .from("attempts")
          .select("id,exam_id,status,extra_minutes,exams!inner(status,ends_at,force_ended_at)")
          .in("status", ["not_started", "acknowledged", "in_progress"])
          .in("exams.status", ["live", "ended"])
          .order("id")
          .range(offset, offset + SCHEDULER_SCAN_PAGE_SIZE - 1);
        if (error) throw new SchedulerSourceError("attempt_scan", error.code);
        const page = (data || []) as unknown as AttemptScanRow[];
        rows.push(...page);
        if (page.length < SCHEDULER_SCAN_PAGE_SIZE) break;
      }

      return rows
        .filter((row) => {
          const exam = oneExam(row.exams);
          if (!exam) return false;
          if (exam.status === "ended" && exam.force_ended_at) {
            return atOrBefore(exam.force_ended_at, cutoff);
          }
          return exam.status === "live"
            && !exam.force_ended_at
            && atOrBefore(exam.ends_at, cutoff, row.extra_minutes);
        })
        .map(({ id, exam_id, status, extra_minutes }) => ({ id, exam_id, status, extra_minutes }));
    },

    async listLifecycleExams(cutoff) {
      const rows: LifecycleScanRow[] = [];
      for (let offset = 0; ; offset += SCHEDULER_SCAN_PAGE_SIZE) {
        const { data, error } = await client
          .from("exams")
          .select("id,status,ends_at,force_ended_at,attempts(extra_minutes)")
          .in("status", ["live", "ended"])
          .order("id")
          .range(offset, offset + SCHEDULER_SCAN_PAGE_SIZE - 1);
        if (error) throw new SchedulerSourceError("lifecycle_scan", error.code);
        const page = (data || []) as unknown as LifecycleScanRow[];
        rows.push(...page);
        if (page.length < SCHEDULER_SCAN_PAGE_SIZE) break;
      }

      return rows
        .filter((exam) => {
          if (exam.status === "ended" && exam.force_ended_at) {
            return atOrBefore(exam.force_ended_at, cutoff);
          }
          if (!exam.ends_at || exam.force_ended_at) return false;
          const attempts = exam.attempts || [];
          return attempts.every((attempt) => atOrBefore(exam.ends_at, cutoff, attempt.extra_minutes));
        })
        .map(({ id }) => ({ id }));
    },
  };
}
