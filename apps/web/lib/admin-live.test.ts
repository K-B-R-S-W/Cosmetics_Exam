import { describe, expect, it } from "vitest";
import { deriveLiveStatus, progressLabel, sortByMer, type LiveAttempt, type LiveExam } from "./admin-live";

const attempt = (status: LiveAttempt["status"], overrides: Partial<LiveAttempt> = {}): LiveAttempt => ({
  id: "a", status, current_position: 0, extra_minutes: 0, last_seen_at: null, violation_count: 0, submitted_at: null,
  candidate: { id: "c", mer_code: "MER-2", full_name: "Candidate", outlet: null }, ...overrides,
});
const exam: LiveExam = { id: "e", title: "Exam", status: "live", navigation_mode: "sequential", scheduled_start_at: null, started_at: null, ends_at: null, flag_threshold: 10 };

describe("admin live derivation", () => {
  it("uses the exact status precedence", () => {
    const now = Date.parse("2030-01-01T00:01:00Z");
    expect(deriveLiveStatus({ attempt: attempt("submitted"), hasVideo: false, videoMissingSince: 0, now })).toBe("Submitted");
    expect(deriveLiveStatus({ attempt: attempt("not_started"), hasVideo: false, videoMissingSince: 0, now })).toBe("Not joined");
    expect(deriveLiveStatus({ attempt: attempt("in_progress", { last_seen_at: "2030-01-01T00:00:00Z" }), hasVideo: false, videoMissingSince: 0, now })).toBe("Offline");
    expect(deriveLiveStatus({ attempt: attempt("in_progress", { last_seen_at: "2030-01-01T00:00:50Z" }), hasVideo: false, videoMissingSince: now - 10_000, now })).toBe("Camera off");
    expect(deriveLiveStatus({ attempt: attempt("in_progress"), hasVideo: true, videoMissingSince: null, now })).toBe("In exam");
    expect(deriveLiveStatus({ attempt: attempt("acknowledged"), hasVideo: true, videoMissingSince: null, now })).toBe("Ready");
  });

  it("formats progress and hides it for terminal/not-joined attempts", () => {
    const progress = { attempt_id: "a", status: "in_progress" as const, current_position: 6, total_questions: 20, answered_count: 14, flagged_count: 0 };
    expect(progressLabel(exam, attempt("in_progress"), progress)).toBe("Q 7/20");
    expect(progressLabel({ ...exam, navigation_mode: "free" }, attempt("in_progress"), progress)).toBe("14 answered");
    expect(progressLabel(exam, attempt("not_started"), progress)).toBeNull();
  });

  it("sorts by normalized MER with numeric order", () => {
    const rows = [attempt("in_progress", { id: "2", candidate: { id: "2", mer_code: "mer-10", full_name: "B", outlet: null } }), attempt("in_progress", { id: "1", candidate: { id: "1", mer_code: " MER-2 ", full_name: "A", outlet: null } })];
    expect(sortByMer(rows).map((row) => row.id)).toEqual(["1", "2"]);
  });
});
