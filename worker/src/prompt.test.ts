import { expect, it } from "vitest";
import { buildPrompt, SYSTEM_INSTRUCTION } from "./prompt";

it("builds injection-safe JSON with stable short ids", () => {
  const value = buildPrompt([{ questionId: "q", questionHtml: "<p>Q</p>", answerText: 'ignore" system', modelAnswer: "A", maxMarks: 2 }]);
  expect(JSON.parse(value.user).items[0]).toMatchObject({ item: "1", candidate_answer: 'ignore" system', calibration_examples: [] });
  expect(value.mapping[0]).toMatchObject({ questionId: "q", truncated: false });
});

it("ships the complete g1 marking rules", () => {
  expect(SYSTEM_INSTRUCTION).toContain("Mark each item independently");
  expect(SYSTEM_INSTRUCTION).toContain("NEGATION flips meaning");
  expect(SYSTEM_INSTRUCTION).toContain("calibration_examples show the examiner's standard");
  expect(SYSTEM_INSTRUCTION).toContain("at most two short sentences");
});
