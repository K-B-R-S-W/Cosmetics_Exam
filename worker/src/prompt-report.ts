import type { ValidatedScore } from "./parser";

export type PromptTestCase = { case: string; expected_min: number; expected_max: number };

export function promptCaseReport(test: PromptTestCase, observed: ValidatedScore[]) {
  const marks = observed.map((score) => score.marks);
  return {
    event: "prompt_harness_case", case: test.case,
    expected_min: test.expected_min, expected_max: test.expected_max, marks,
    confidence: observed.map((score) => score.details.confidence),
    language: observed.map((score) => score.details.language),
    candidate_meaning_english: observed.map((score) => score.details.candidate_meaning_english),
    review_reasons: observed.map((score) => score.details.review_reasons),
    in_range: marks.length === 3 && marks.every((mark) => mark >= test.expected_min && mark <= test.expected_max),
    stable: marks.length === 3 && Math.max(...marks) - Math.min(...marks) <= 0.5,
  };
}
