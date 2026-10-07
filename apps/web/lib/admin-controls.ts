import { z } from "zod";

export const confirmSchema = z.object({ confirm: z.literal(true) }).strict();
export const extendExamSchema = z.object({
  minutes: z.number().int().min(1).max(120),
  attempt_id: z.uuid().optional(),
}).strict();
export const broadcastSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  audience: z.enum(["all", "custom"]),
  candidate_ids: z.array(z.uuid()).min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (value.audience === "all" && value.candidate_ids !== undefined) context.addIssue({ code: "custom", path: ["candidate_ids"], message: "Candidate IDs are only allowed for selected candidates." });
  if (value.audience === "custom" && !value.candidate_ids?.length) context.addIssue({ code: "custom", path: ["candidate_ids"], message: "Select at least one candidate." });
});

export const adminActionNames = [
  "candidate_create", "candidate_update", "candidate_delete", "candidate_import", "candidate_unlock",
  "exam_create", "exam_update", "exam_delete", "exam_assign", "exam_unassign", "question_save",
  "question_delete", "question_reorder", "answer_key_save", "start", "extend", "force_end",
  "force_submit", "kick", "broadcast", "grade_start", "grade_resume", "override", "regrade",
  "regrade_question", "alert_resolve", "snapshot_purge", "event_dismiss", "event_restore",
] as const;
export type AdminActionName = typeof adminActionNames[number];

export function uniqueIds(ids: string[] | undefined): string[] | null {
  return ids ? [...new Set(ids)] : null;
}
