import { describe, expect, it } from "vitest";

import type { ResultsSummaryRow } from "./results-summary";
import { rankRows } from "./rank";

function row(
  attempt_id: string,
  total_percent: number | null,
  overrides: Partial<ResultsSummaryRow> = {},
): ResultsSummaryRow {
  return {
    attempt_id,
    mer_code: attempt_id,
    full_name: attempt_id,
    outlet: null,
    attempt_status: "finalized",
    submit_reason: "manual",
    violations_counted: 0,
    violations_logged: 0,
    question_numbers: [1],
    mcq_marks: 0,
    written_marks: 0,
    total_marks: 0,
    total_percent,
    needs_review_count: 0,
    unscored_count: 0,
    is_final: true,
    is_absent: false,
    ...overrides,
  };
}

describe("rankRows", () => {
  it("assigns competition ranks and shares places for equal percentages", () => {
    const ranks = rankRows([
      row("fourth", 70),
      row("first", 95),
      row("second-a", 80),
      row("second-b", 80),
    ]);

    expect([...ranks.entries()]).toEqual([
      ["fourth", 4],
      ["first", 1],
      ["second-a", 2],
      ["second-b", 2],
    ]);
  });

  it("gives all equal final results the same rank", () => {
    expect([...rankRows([row("a", 50), row("b", 50), row("c", 50)]).values()]).toEqual([1, 1, 1]);
  });

  it("ranks a single final candidate first", () => {
    expect(rankRows([row("only", 83.5)]).get("only")).toBe(1);
  });

  it("leaves absent and non-final rows unranked", () => {
    const ranks = rankRows([
      row("ranked", 60),
      row("absent", null, { is_absent: true }),
      row("pending", 99, { is_final: false }),
    ]);

    expect(ranks.get("ranked")).toBe(1);
    expect(ranks.get("absent")).toBeNull();
    expect(ranks.get("pending")).toBeNull();
  });

  it("orders mixed percentages descending and ties only by percentage", () => {
    const ranks = rankRows([
      row("low", 10, { total_marks: 100 }),
      row("high", 90, { total_marks: 1 }),
      row("tie-a", 45, { total_marks: 2 }),
      row("tie-b", 45, { total_marks: 200 }),
      row("missing", null),
    ]);

    expect(ranks).toEqual(new Map([
      ["low", 4],
      ["high", 1],
      ["tie-a", 2],
      ["tie-b", 2],
      ["missing", null],
    ]));
  });
});
