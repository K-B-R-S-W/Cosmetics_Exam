import { describe, expect, it } from "vitest";

import {
  createQuestionSchema,
  sanitizeOptionHtml,
  sanitizeQuestionHtml,
} from "@/lib/questions";

const questionId = "00000000-0000-4000-8000-000000000101";
const examId = "00000000-0000-4000-8000-000000000102";
const optionA = "00000000-0000-4000-8000-000000000103";
const optionB = "00000000-0000-4000-8000-000000000104";

function validQuestion() {
  return {
    id: questionId,
    exam_id: examId,
    type: "mcq" as const,
    body_html: "<p>Question</p>",
    image: null,
    marks: 1,
    position: null,
    options: [
      { id: optionA, text_html: "<p>A</p>" },
      { id: optionB, text_html: "<p>B</p>" },
    ],
    answer_key: { correct_option_id: optionA, model_answer: null, grading_notes: null, calibration: [] },
  };
}

describe("question schemas", () => {
  it("accepts the complete valid MCQ document", () => {
    expect(createQuestionSchema.parse(validQuestion()).marks).toBe(1);
  });

  it("rejects option IDs that are not UUIDs before an RPC can run", () => {
    const input = validQuestion();
    input.options[0]!.id = "not-a-uuid";
    expect(createQuestionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects partial image metadata", () => {
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      image: { path: "questions/x.jpg", alt_text: "Image" },
    }).success).toBe(false);
  });

  it.each([1000, 1.001, 0, -1])("rejects invalid marks %s", (marks) => {
    expect(createQuestionSchema.safeParse({ ...validQuestion(), marks }).success).toBe(false);
  });

  it("rejects body and option values beyond their contract lengths", () => {
    expect(createQuestionSchema.safeParse({ ...validQuestion(), body_html: "x".repeat(50_001) }).success).toBe(false);
    const input = validQuestion();
    input.options[0]!.text_html = "x".repeat(5_001);
    expect(createQuestionSchema.safeParse(input).success).toBe(false);
  });

  it.each(["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<p>   </p>"])("rejects a body with no visible text: %s", (bodyHtml) => {
    expect(createQuestionSchema.safeParse({ ...validQuestion(), body_html: bodyHtml }).success).toBe(false);
  });

  it("allows an image-only question body", () => {
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      body_html: "<p><br></p>",
      image: {
        path: "questions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000105.jpg",
        alt_text: "Synthetic diagram",
        mime: "image/jpeg",
        size_bytes: 123,
      },
    }).success).toBe(true);
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      body_html: "",
      image: {
        path: "questions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000105.jpg",
        alt_text: "Synthetic diagram",
        mime: "image/jpeg",
        size_bytes: 123,
      },
    }).success).toBe(true);
  });

  it.each(["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<p>   </p>"])("rejects option text with no visible text: %s", (textHtml) => {
    const input = validQuestion();
    input.options[0]!.text_html = textHtml;
    expect(createQuestionSchema.safeParse(input).success).toBe(false);
  });

  it("preserves and accepts visible Sinhala text", () => {
    const input = validQuestion();
    input.body_html = "<p>නිවැරදි පිළිතුර තෝරන්න</p>";
    input.options[0]!.text_html = "<p>පළමු පිළිතුර</p>";
    expect(createQuestionSchema.parse(input).body_html).toBe(input.body_html);
  });

  it("rejects calibration marks above the question marks", () => {
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      type: "written",
      marks: 2,
      options: [],
      answer_key: {
        correct_option_id: null,
        model_answer: "Answer",
        grading_notes: null,
        calibration: [{ answer: "Example", marks: 2.01, note: "Too high" }],
      },
    }).success).toBe(false);
  });

  it("enforces two to ten options, unique IDs and a correct option from this question", () => {
    const one = validQuestion();
    one.options = one.options.slice(0, 1);
    expect(createQuestionSchema.safeParse(one).success).toBe(false);
    const duplicate = validQuestion();
    duplicate.options[1]!.id = duplicate.options[0]!.id;
    expect(createQuestionSchema.safeParse(duplicate).success).toBe(false);
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      answer_key: { ...validQuestion().answer_key, correct_option_id: questionId },
    }).success).toBe(false);
  });

  it("enforces the MCQ/written field matrix", () => {
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      answer_key: { ...validQuestion().answer_key, model_answer: "not allowed" },
    }).success).toBe(false);
    expect(createQuestionSchema.safeParse({
      ...validQuestion(),
      type: "written",
      options: [],
      answer_key: { correct_option_id: optionA, model_answer: "Answer", grading_notes: null, calibration: [] },
    }).success).toBe(false);
  });
});

describe("question HTML allowlist", () => {
  it("keeps the Section 3 tags and only a valid span font-size", () => {
    const input = '<h2>H</h2><p><strong>B</strong><b>b</b><em>E</em><i>i</i><u>u</u><s>s</s><br><span style="font-size:120%;color:red" class="x">T</span></p><ul><li>U</li></ul><ol><li>O</li></ol>';
    const output = sanitizeQuestionHtml(input);
    expect(output).toContain("<h2>H</h2>");
    expect(output).toContain('style="font-size:120%"');
    expect(output).not.toContain("color");
    expect(output).not.toContain("class");
  });

  it("removes scripts, links, images, events, sub/sup and invalid font sizes", () => {
    const output = sanitizeQuestionHtml('<p onclick="x()"><a href="x">link</a><img src="x"><script>x()</script><sub>a</sub><sup>b</sup><span style="font-size:1000px">bad</span></p>');
    expect(output).toBe("<p>linkab<span>bad</span></p>");
  });

  it("removes headings from option text", () => {
    expect(sanitizeOptionHtml("<h2>Heading</h2><p>Choice</p>")).toBe("Heading<p>Choice</p>");
  });
});
