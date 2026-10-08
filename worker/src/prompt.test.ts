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
  expect(SYSTEM_INSTRUCTION).toContain("question_image_description");
});

it("includes a sanitized capped image description only when present", () => {
  const withImage = buildPrompt([{ questionId: "q1", questionHtml: "<p>Q</p>", questionImageDescription: `<b>Skin &amp; labels</b> ${"x".repeat(600)}`, answerText: "A", modelAnswer: "M", maxMarks: 1 }]);
  const withoutImage = buildPrompt([{ questionId: "q2", questionHtml: "<p>Q</p>", answerText: "A", modelAnswer: "M", maxMarks: 1 }]);
  const described = JSON.parse(withImage.user).items[0];
  const plain = JSON.parse(withoutImage.user).items[0];
  expect(described.question_image_description).toMatch(/^Skin &amp; labels/u);
  expect(described.question_image_description).not.toContain("<b>");
  expect(described.question_image_description).toHaveLength(500);
  expect(plain).not.toHaveProperty("question_image_description");
});
