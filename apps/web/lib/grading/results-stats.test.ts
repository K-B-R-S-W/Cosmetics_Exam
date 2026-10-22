import { describe, expect, it } from "vitest";

import type { ResultsSummaryRow } from "./results-summary";
import { calculateResultsStats, formatPercent } from "./results-stats";

function row(overrides: Partial<ResultsSummaryRow> = {}): ResultsSummaryRow {
  return {
    attempt_id: "attempt",
    mer_code: "MER-1",
    full_name: "Synthetic Candidate",
    outlet: null,
    attempt_status: "submitted",
    submit_reason: "manual",
    violations_counted: 0,
    violations_logged: 0,
    question_numbers: [],
    mcq_marks: null,
    written_marks: null,
    total_marks: null,
    total_percent: null,
    needs_review_count: 0,
    unscored_count: 0,
    is_final: false,
    is_absent: false,
    ...overrides,
  };
}

describe("calculateResultsStats", () => {
  it("returns zero counts and no percentages for empty data", () => {
    expect(calculateResultsStats([])).toEqual({ taken: 0, absent: 0, final: 0, averagePercent: null, highestPercent: null, lowestPercent: null });
  });

  it("does not treat absent candidates as taken or scored", () => {
    expect(calculateResultsStats([row({ is_absent: true, total_percent: null })])).toEqual({ taken: 0, absent: 1, final: 0, averagePercent: null, highestPercent: null, lowestPercent: null });
  });

  it("calculates final and scored statistics from mixed data", () => {
    expect(calculateResultsStats([
      row({ attempt_id: "one", total_percent: 50, is_final: true }),
      row({ attempt_id: "two", total_percent: 80, is_final: true }),
      row({ attempt_id: "three", total_percent: null }),
      row({ attempt_id: "absent", is_absent: true }),
    ])).toEqual({ taken: 3, absent: 1, final: 2, averagePercent: 65, highestPercent: 80, lowestPercent: 50 });
  });
});

it("formats percentages consistently", () => {
  expect(formatPercent(65)).toBe("65.0%");
  expect(formatPercent(65.26)).toBe("65.3%");
  expect(formatPercent(null)).toBe("—");
});
