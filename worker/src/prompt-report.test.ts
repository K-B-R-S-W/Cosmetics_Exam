import { expect, it } from "vitest";
import { promptCaseReport } from "./prompt-report";

it("reports the canonical range, stability, meaning and review evidence", () => {
  const score = {
    questionId: "case", marks: 1, maxMarks: 2, reason: "Partial.", needsReview: true,
    details: { confidence: 0.7, language: "singlish", candidate_meaning_english: "Meaning", review_reasons: ["low_confidence_singlish"] },
  };
  const report = promptCaseReport({ case: "case", expected_min: 0.5, expected_max: 1.5 }, [score, score, score]);
  expect(report).toMatchObject({ marks: [1, 1, 1], confidence: [0.7, 0.7, 0.7], language: ["singlish", "singlish", "singlish"], candidate_meaning_english: ["Meaning", "Meaning", "Meaning"], in_range: true, stable: true });
});
