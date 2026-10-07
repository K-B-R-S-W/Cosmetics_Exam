export type LiveExam = {
  id: string;
  title: string;
  status: "draft" | "scheduled" | "live" | "ended" | "finalized";
  navigation_mode: "free" | "sequential";
  scheduled_start_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  force_ended_at: string | null;
  duration_min: number;
  flag_threshold: number;
};

export type LiveAttempt = {
  id: string;
  status: "not_started" | "acknowledged" | "in_progress" | "submitted" | "finalized";
  current_position: number;
  extra_minutes: number;
  last_seen_at: string | null;
  violation_count: number;
  submitted_at: string | null;
  candidate: { id: string; mer_code: string; full_name: string; outlet: string | null };
};

export type LiveProgress = {
  attempt_id: string;
  status: LiveAttempt["status"];
  current_position: number;
  total_questions: number;
  answered_count: number;
  flagged_count: number;
};

export type LiveStatus = "Submitted" | "Not joined" | "Offline" | "Camera off" | "In exam" | "Ready";

export function deriveLiveStatus(input: {
  attempt: LiveAttempt;
  hasVideo: boolean;
  videoMissingSince: number | null;
  now: number;
}): LiveStatus {
  const { attempt, hasVideo, videoMissingSince, now } = input;
  if (attempt.status === "submitted" || attempt.status === "finalized") return "Submitted";
  if (attempt.status === "not_started") return "Not joined";
  if (attempt.last_seen_at && now - Date.parse(attempt.last_seen_at) > 25_000) return "Offline";
  if (!hasVideo && videoMissingSince !== null && now - videoMissingSince >= 10_000) return "Camera off";
  return attempt.status === "in_progress" ? "In exam" : "Ready";
}

export function progressLabel(exam: LiveExam, attempt: LiveAttempt, progress?: LiveProgress): string | null {
  if (!progress || attempt.status === "not_started" || attempt.status === "submitted" || attempt.status === "finalized") return null;
  return exam.navigation_mode === "sequential"
    ? `Q ${Math.min(progress.current_position + 1, progress.total_questions)}/${progress.total_questions}`
    : `${progress.answered_count} answered`;
}

export function sortByMer(attempts: LiveAttempt[]): LiveAttempt[] {
  return [...attempts].sort((left, right) => left.candidate.mer_code.trim().toUpperCase().localeCompare(
    right.candidate.mer_code.trim().toUpperCase(),
    "en",
    { numeric: true },
  ));
}
