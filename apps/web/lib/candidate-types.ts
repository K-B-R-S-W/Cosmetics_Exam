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

export interface CandidateQuestion {
  id: string;
  position: number;
  type: "mcq" | "written";
  body_html: string;
  image: {
    url: string;
    alt_text: string;
  } | null;
  marks: number;
  options?: Array<{ id: string; text_html: string }>;
}

export interface SavedAnswer {
  answer_text: string | null;
  selected_option_id: string | null;
  flagged: boolean;
  revision: number;
  saved_at: string;
}

export interface AnswerInput {
  question_id: string;
  answer_text: string | null;
  selected_option_id: string | null;
  flagged: boolean;
  revision: number;
}

export type SaveAnswerResult =
  | { result: "saved"; server_time: string }
  | { result: "stale_revision"; server_revision: number; server_time: string };

export interface NextQuestionBody {
  result: "advanced" | "already_advanced" | "out_of_sync";
  position: number;
  total_questions: number;
  question: CandidateQuestion;
  answer: SavedAnswer | null;
  server_time: string;
}

export interface PaperBody {
  server_time: string;
  navigation_mode: "free" | "sequential";
  total_questions: number;
  current_position: number | null;
  questions: CandidateQuestion[];
  answers: Record<string, SavedAnswer>;
}
