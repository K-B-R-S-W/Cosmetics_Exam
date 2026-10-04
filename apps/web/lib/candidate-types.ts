export type AttemptStatus =
  | "not_started"
  | "acknowledged"
  | "in_progress"
  | "submitted"
  | "finalized";

export type ExamPhase = "waiting" | "live" | "submitted" | "closed";

export interface StateBody {
  server_time: string;
  phase: ExamPhase;
  exam: {
    id: string;
    title: string;
    status: "draft" | "scheduled" | "live" | "ended" | "finalized";
    navigation_mode: "free" | "sequential";
    scheduled_start_at: string | null;
    started_at: string | null;
    ends_at: string | null;
    force_ended: boolean;
    question_count: number;
  };
  attempt: {
    id: string;
    status: AttemptStatus;
    current_position: number;
    extra_minutes: number;
    deadline: string | null;
    submit_reason: "manual" | "auto" | "forced" | null;
  };
  announcements: Array<{ id: string; sent_at: string }>;
}

export interface CandidateMe {
  candidate: { mer_code: string; full_name: string; outlet: string | null };
  exam: {
    id: string;
    title: string;
    instructions: string | null;
    scheduled_start_at: string | null;
    duration_min: number;
    navigation_mode: "free" | "sequential";
    question_count: number;
    status: "draft" | "scheduled" | "live" | "ended" | "finalized";
  };
  attempt: { id: string; status: AttemptStatus };
  rules: { snapshot_retention_days: number };
}

export interface ApiErrorPayload {
  error: { code: string; message: string; details?: unknown };
}
