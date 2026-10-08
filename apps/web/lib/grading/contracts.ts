import { z } from "zod";

export const GRADING_MODEL = "gemini-3.7-flash" as const;

export const gradeStartSchema = z.strictObject({
  chunk_size: z.number().int().min(1).max(10).default(10),
  mcq_only: z.boolean().default(false),
});
export const resumeRunSchema = z.strictObject({ failed_only: z.boolean().default(true) });
export const questionRegradeSchema = z.strictObject({ question_id: z.uuid() });
export const attemptRegradeSchema = z.strictObject({ question_id: z.uuid() });
export const overrideSchema = z.strictObject({
  question_id: z.uuid(), marks: z.number().min(0).max(999.99), note: z.string().trim().min(1).max(1_000),
});

export type SafeRpcErrorCode =
  | "validation_failed" | "not_found" | "exam_not_finalized" | "not_finalized"
  | "grading_in_progress" | "regrade_in_progress" | "missing_answer_keys"
  | "missing_answer_key" | "nothing_to_grade" | "not_resumable" | "not_written";

const statusByCode: Record<SafeRpcErrorCode, number> = {
  validation_failed: 400, not_found: 404, exam_not_finalized: 409, not_finalized: 409,
  grading_in_progress: 409, regrade_in_progress: 409, missing_answer_keys: 409,
  missing_answer_key: 409, nothing_to_grade: 409, not_resumable: 409, not_written: 400,
};

export function gradingRpcStatus(message: string): number | null {
  return Object.hasOwn(statusByCode, message) ? statusByCode[message as SafeRpcErrorCode] : null;
}

export function documentedRpcDetails(code: string, detail: string | null | undefined): unknown {
  if (!detail) return null;
  if (code === "grading_in_progress" && z.uuid().safeParse(detail).success) return { run_id: detail };
  if (code === "missing_answer_keys") {
    try {
      const parsed = z.array(z.uuid()).safeParse(JSON.parse(detail));
      if (parsed.success) return { question_ids: parsed.data };
    } catch { /* generic response */ }
  }
  return null;
}
