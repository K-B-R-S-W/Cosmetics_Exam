import { z } from "zod";

export const EXAM_TITLE_MAX_LENGTH = 150;
export const EXAM_INSTRUCTIONS_MAX_LENGTH = 4000;
export const EXAM_DURATION_MIN = 1;
export const EXAM_DURATION_MAX = 480;
export const FLAG_THRESHOLD_MIN = 1;
export const FLAG_THRESHOLD_MAX = 100;
export const AVAILABLE_CANDIDATE_SCAN_LIMIT = 1000;
export const COLOMBO_OFFSET_MINUTES = 330;

export const examStatuses = [
  "draft",
  "scheduled",
  "live",
  "ended",
  "finalized",
] as const;
export type ExamStatus = (typeof examStatuses)[number];
export type NavigationMode = "free" | "sequential";

const nullableInstructions = z
  .string()
  .trim()
  .max(EXAM_INSTRUCTIONS_MAX_LENGTH)
  .transform((value) => value || null)
  .nullable()
  .optional();

const scheduledAtSchema = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();

const examFieldsSchema = z.object({
  title: z.string().trim().min(1).max(EXAM_TITLE_MAX_LENGTH),
  instructions: nullableInstructions,
  duration_min: z.coerce.number().int().min(EXAM_DURATION_MIN).max(EXAM_DURATION_MAX),
  scheduled_start_at: scheduledAtSchema,
  navigation_mode: z.enum(["free", "sequential"]),
  shuffle: z.boolean(),
  flag_threshold: z.coerce.number().int().min(FLAG_THRESHOLD_MIN).max(FLAG_THRESHOLD_MAX),
  is_practice: z.boolean(),
});

export const createExamSchema = examFieldsSchema.extend({
  navigation_mode: z.enum(["free", "sequential"]).default("free"),
  shuffle: z.boolean().default(false),
  flag_threshold: z.coerce.number().int().min(FLAG_THRESHOLD_MIN).max(FLAG_THRESHOLD_MAX).default(10),
  is_practice: z.boolean().default(false),
});

export const updateExamSchema = examFieldsSchema
  .partial()
  .extend({ status: z.enum(examStatuses).optional() })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  });

export const examIdSchema = z.uuid();

export const examCandidatesQuerySchema = z.object({
  view: z.enum(["assigned", "available"]).optional().default("assigned"),
  q: z.string().trim().max(200).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const examCandidateMutationSchema = z.object({
  candidate_ids: z.array(z.uuid()).min(1).max(200).transform((ids) => [...new Set(ids)]),
});

export interface ExamItem {
  id: string;
  title: string;
  instructions: string | null;
  scheduled_start_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  force_ended_at: string | null;
  duration_min: number;
  status: ExamStatus;
  navigation_mode: NavigationMode;
  shuffle: boolean;
  flag_threshold: number;
  is_practice: boolean;
  created_at: string;
  question_count: number;
  assigned_count: number;
}

export interface ExamWarning {
  code: "missing_answer_key";
  question_ids: string[];
}

export interface AssignedCandidateItem {
  candidate_id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  attempt_id: string;
  attempt_status: "not_started" | "acknowledged" | "in_progress" | "submitted" | "finalized";
}

export interface AvailableCandidateItem {
  candidate_id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
}

const COLOMBO_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function colomboInputToUtc(value: string): string {
  const match = COLOMBO_LOCAL_PATTERN.exec(value);
  if (!match) throw new Error("invalid_colombo_datetime");
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(localAsUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    throw new Error("invalid_colombo_datetime");
  }
  return new Date(localAsUtc - COLOMBO_OFFSET_MINUTES * 60_000).toISOString();
}

export function utcToColomboInput(value: string | null): string {
  if (!value) return "";
  const shifted = new Date(new Date(value).getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  if (Number.isNaN(shifted.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

export function formatColomboDateTime(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-LK", {
    timeZone: "Asia/Colombo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function examStatusLabel(status: ExamStatus): string {
  if (status === "ended") return "Ended, finalizing";
  return status[0].toUpperCase() + status.slice(1);
}

export function schedulingMissing(
  exam: Pick<ExamItem, "scheduled_start_at" | "question_count" | "assigned_count">,
  now = new Date(),
): string[] {
  const missing: string[] = [];
  if (exam.question_count < 1) missing.push("questions");
  if (exam.assigned_count < 1) missing.push("candidates");
  if (
    !exam.scheduled_start_at ||
    new Date(exam.scheduled_start_at).getTime() < now.getTime() + 60_000
  ) {
    missing.push("start_time");
  }
  return missing;
}
