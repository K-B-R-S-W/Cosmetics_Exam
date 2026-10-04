import { describe, expect, it } from "vitest";

import {
  candidateIdBatches,
  colomboInputToUtc,
  createExamSchema,
  examCandidateMutationSchema,
  schedulingMissing,
  utcToColomboInput,
  updateExamSchema,
} from "./exams";

describe("exam schemas and Colombo time", () => {
  it("converts Colombo local input to UTC without using the machine timezone", () => {
    expect(colomboInputToUtc("2026-10-05T09:30")).toBe("2026-10-05T04:00:00.000Z");
    expect(colomboInputToUtc("2026-01-01T00:15")).toBe("2025-12-31T18:45:00.000Z");
    expect(utcToColomboInput("2026-10-05T04:00:00.000Z")).toBe("2026-10-05T09:30");
  });

  it("rejects invalid dates and enforces exam limits", () => {
    expect(() => colomboInputToUtc("2026-02-30T09:00")).toThrow("invalid_colombo_datetime");
    expect(createExamSchema.safeParse({ title: "", duration_min: 0 }).success).toBe(false);
    expect(createExamSchema.safeParse({ title: "Exam", duration_min: 45 }).data).toMatchObject({
      navigation_mode: "free",
      shuffle: false,
      flag_threshold: 10,
    });
    expect(updateExamSchema.safeParse({ flag_threshold: 101 }).success).toBe(false);
    expect(updateExamSchema.parse({ title: "Only title" })).toEqual({ title: "Only title" });
  });

  it("uses the Section 2C readiness blockers", () => {
    const now = new Date("2026-10-04T00:00:00.000Z");
    expect(schedulingMissing({ scheduled_start_at: null, question_count: 0, assigned_count: 0 }, now)).toEqual([
      "questions",
      "candidates",
      "start_time",
    ]);
    expect(schedulingMissing({ scheduled_start_at: "2026-10-04T00:02:00.000Z", question_count: 1, assigned_count: 1 }, now)).toEqual([]);
  });

  it("caps one candidate mutation at 100 IDs", () => {
    const ids = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    expect(examCandidateMutationSchema.safeParse({ candidate_ids: ids.slice(0, 100) }).success).toBe(true);
    expect(examCandidateMutationSchema.safeParse({ candidate_ids: ids }).success).toBe(false);
  });

  it("splits 230 candidate IDs into 100, 100 and 30", () => {
    const ids = Array.from({ length: 230 }, (_, index) => `candidate-${index}`);
    expect(candidateIdBatches(ids).map((batch) => batch.length)).toEqual([100, 100, 30]);
  });
});
