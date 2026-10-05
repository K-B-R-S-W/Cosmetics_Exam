import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { candidateEventSchema, dismissEventSchema, normalizeHeartbeatState } from "./proctoring-contract";

const id = "00000000-0000-4000-8000-000000000001";

describe("proctoring contract", () => {
  it("rejects unknown event and dismiss keys", () => {
    expect(candidateEventSchema.safeParse({ id, type: "COPY", merged_types: [], occurred_ago_ms: 0, duration_ms: null, meta: null, extra: true }).success).toBe(false);
    expect(dismissEventSchema.safeParse({ dismissed: true, note: "Synthetic", extra: true }).success).toBe(false);
  });

  it("rejects non-object or oversized metadata", () => {
    const base = { id, type: "COPY", merged_types: [], occurred_ago_ms: 0, duration_ms: null };
    expect(candidateEventSchema.safeParse({ ...base, meta: [] }).success).toBe(false);
    expect(candidateEventSchema.safeParse({ ...base, meta: { text: "x".repeat(2100) } }).success).toBe(false);
  });

  it("normalizes the real RPC state shape to ISO strings", () => {
    const state = normalizeHeartbeatState({
      server_time: "2026-10-05 10:30:00+00", phase: "live",
      exam: { id, title: "Synthetic", status: "live", navigation_mode: "free", scheduled_start_at: null, started_at: "2026-10-05 10:00:00+00", ends_at: "2026-10-05 11:00:00+00", force_ended: false, question_count: 3 },
      attempt: { id, status: "in_progress", current_position: 0, extra_minutes: 0, deadline: "2026-10-05 11:00:00+00", submit_reason: null },
      announcements: [{ id, sent_at: "2026-10-05 10:20:00+00" }],
    });
    expect(state.server_time).toBe("2026-10-05T10:30:00.000Z");
    expect(state.exam.started_at).toBe("2026-10-05T10:00:00.000Z");
    expect(state.attempt.deadline).toBe("2026-10-05T11:00:00.000Z");
    expect(state.announcements[0]?.sent_at).toBe("2026-10-05T10:20:00.000Z");
  });
});
