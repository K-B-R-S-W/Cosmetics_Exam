import { expect, it } from "vitest";
import { parseGradingResponse, roundMark } from "./parser";

it("rounds, clamps and reports missing items", () => {
  const result = parseGradingResponse(JSON.stringify([{ item: "1", marks: 3.8, reason: "ok", matched_points: [], missing_points: [], incorrect_claims: [], confidence: .9, language: "english", candidate_meaning_english: "", verdict: "correct" }]), [
    { id: "1", questionId: "q1", maxMarks: 3, truncated: false }, { id: "2", questionId: "q2", maxMarks: 2, truncated: false },
  ]);
  expect(roundMark(1.26)).toBe(1.5);
  expect(result.scores[0]).toMatchObject({ marks: 3, needsReview: true });
  expect(result.missing).toEqual(["q2"]);
});
