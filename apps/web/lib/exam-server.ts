import "server-only";

import { ApiError } from "@/lib/api";
import type { ExamItem, ExamStatus, NavigationMode } from "@/lib/exams";

export const EXAM_COLUMNS =
  "id, title, instructions, scheduled_start_at, started_at, ends_at, force_ended_at, duration_min, status, navigation_mode, shuffle, flag_threshold, is_practice, created_at";

interface ExamRecord {
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
  questions?: Array<{ count?: number }> | null;
  exam_candidates?: Array<{ count?: number }> | null;
}

export function toExamItem(record: ExamRecord): ExamItem {
  return {
    id: record.id,
    title: record.title,
    instructions: record.instructions,
    scheduled_start_at: record.scheduled_start_at,
    started_at: record.started_at,
    ends_at: record.ends_at,
    force_ended_at: record.force_ended_at,
    duration_min: record.duration_min,
    status: record.status,
    navigation_mode: record.navigation_mode,
    shuffle: record.shuffle,
    flag_threshold: record.flag_threshold,
    is_practice: record.is_practice,
    created_at: record.created_at,
    question_count: record.questions?.[0]?.count ?? 0,
    assigned_count: record.exam_candidates?.[0]?.count ?? 0,
  };
}

export function examNotFound(): ApiError {
  return new ApiError("not_found", 404, "Exam not found.");
}
