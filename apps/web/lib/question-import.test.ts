import { describe, expect, it } from "vitest";

import { questionIsDirty } from "@/components/admin/questions/question-dirty";
import {
  plainTextToEditorHtml,
  prepareQuestionImport,
  questionDuplicateSignature,
  questionImportBatches,
  type QuestionImportRow,
} from "./question-import";

function row(sourceRow: number, values: Partial<QuestionImportRow> = {}): QuestionImportRow {
  return {
    source_row: sourceRow, type: "", question: "Question", option_a: "", option_b: "", option_c: "", option_d: "", option_e: "",
    option_f: "", option_g: "", option_h: "", option_i: "", option_j: "", correct: "", marks: "1", model_answer: "", grading_notes: "", ...values,
  };
}
const examId = "00000000-0000-4000-8000-000000000100";

describe("question import contracts", () => {
  it("auto-detects mixed MCQ and written rows with four and seven options", () => {
    const four = row(2, { question: "Four", option_a: "A", option_b: "B", option_c: "C", option_d: "D", correct: "D" });
    const seven = row(3, { question: "Seven", option_a: "A", option_b: "B", option_c: "C", option_d: "D", option_e: "E", option_f: "F", option_g: "G", correct: "G" });
    const written = row(4, { question: "Written", model_answer: "Model" });
    const result = prepareQuestionImport([four, seven, written], examId, []);
    expect(result.issues).toEqual([]);
    expect(result.ready.map((item) => [item.document.type, item.document.options.length])).toEqual([["mcq", 4], ["mcq", 7], ["written", 0]]);
  });

  it("accepts correct by letter or exact text and rejects an unfilled letter", () => {
    const result = prepareQuestionImport([
      row(2, { option_a: "One", option_b: "Two", correct: "B" }),
      row(3, { question: "Second", option_a: "One", option_b: "Two", correct: "Two" }),
      row(4, { question: "Third", option_a: "One", option_b: "Two", correct: "C" }),
    ], examId, []);
    expect(result.ready).toHaveLength(2);
    expect(result.issues).toEqual([expect.objectContaining({ row: 4, code: "invalid_correct" })]);
  });

  it("rejects multiple correct answers with a friendly row-level message", () => {
    const result = prepareQuestionImport([
      row(2, { option_a: "One", option_b: "Two", correct: "A,B" }),
      row(3, { question: "Second", option_a: "One", option_b: "Two", option_d: "Four", correct: "A,B,D" }),
    ], examId, []);

    expect(result.issues).toEqual([
      { row: 2, code: "multiple_correct_answers", message: "Only one correct answer is supported; this row lists several." },
      { row: 3, code: "multiple_correct_answers", message: "Only one correct answer is supported; this row lists several." },
    ]);
  });

  it("accepts exact option text that resembles a multiple-answer list", () => {
    const values = ["Salt, pepper", "R&D", "Input/Output", "Research and development", "Dad", "Bee"];
    const result = prepareQuestionImport(values.map((value, index) => row(index + 2, {
      question: `Exact text ${index}`,
      option_a: value,
      option_b: "Another option",
      correct: value,
    })), examId, []);

    expect(result.issues).toEqual([]);
    expect(result.ready).toHaveLength(values.length);
  });

  it("trims whitespace and stray quotes around a single correct answer", () => {
    const result = prepareQuestionImport([
      row(2, { option_a: "One", option_b: "Two", correct: '  "B"  ' }),
      row(3, { question: "By text", option_a: "One", option_b: "Two", correct: " 'Two' " }),
    ], examId, []);

    expect(result.issues).toEqual([]);
    expect(result.ready).toHaveLength(2);
  });

  it("uses the invalid-correct message when a non-list value matches no option", () => {
    const result = prepareQuestionImport([row(2, { option_a: "One", option_b: "Two", correct: "Unknown" })], examId, []);

    expect(result.issues).toEqual([{
      row: 2,
      code: "invalid_correct",
      message: "Correct must be a filled option letter or the exact option text.",
    }]);
  });

  it("reports identical matching option text as ambiguous", () => {
    const result = prepareQuestionImport([row(2, { option_a: "Same", option_b: "Same", correct: "Same" })], examId, []);

    expect(result.issues).toEqual([{
      row: 2,
      code: "ambiguous_correct",
      message: "Correct matches more than one option. Use the option letter instead.",
    }]);
  });

  it("requires a non-blank model answer for every written row", () => {
    const result = prepareQuestionImport([row(2, { type: "written", model_answer: "   " })], examId, []);
    expect(result.issues[0]).toMatchObject({ code: "missing_model_answer" });
  });

  it("reports missing text, too few options, and field length limits", () => {
    const result = prepareQuestionImport([
      row(2, { question: "", model_answer: "Model" }),
      row(3, { type: "mcq", option_a: "Only", correct: "A" }),
      row(4, { question: "x".repeat(50_001), model_answer: "Model" }),
      row(5, { question: "Long option", option_a: "x".repeat(5_001), option_b: "B", correct: "B" }),
      row(6, { question: "Long model", model_answer: "x".repeat(10_001) }),
    ], examId, []);
    expect(result.issues.map((item) => item.code)).toEqual([
      "missing_question", "too_few_options", "question_too_long", "option_too_long", "model_answer_too_long",
    ]);
  });

  it("round-trips Sinhala and escapes imported plain text into editor-normalised HTML", () => {
    const html = plainTextToEditorHtml("සිංහල <පෙළ> & answer");
    expect(html).toBe("<p>සිංහල &lt;පෙළ&gt; &amp; answer</p>");
    const imported = prepareQuestionImport([row(2, { question: "සිංහල ප්‍රශ්නය", model_answer: "සිංහල පිළිතුර" })], examId, []).ready[0]!.document;
    const editor = { ...imported, persisted: true };
    expect(questionIsDirty(editor, structuredClone(editor), String(editor.marks))).toBe(false);
  });

  it("detects duplicates within the file and across target and other exams despite case or punctuation", () => {
    const existing = [
      { exam_id: examId, exam_title: "Target Exam", type: "written" as const, body_html: "<p>Existing, Question!</p>", option_html: [] },
      { exam_id: "other", exam_title: "Other Exam", type: "mcq" as const, body_html: "<p>Capital?</p>", option_html: ["<p>B</p>", "<p>A</p>"] },
    ];
    const result = prepareQuestionImport([
      row(2, { question: "Repeat me", model_answer: "M" }),
      row(3, { question: "REPEAT, ME!", model_answer: "M" }),
      row(4, { question: "existing question", model_answer: "M" }),
      row(5, { question: "CAPITAL", option_a: "A", option_b: "B", correct: "A" }),
    ], examId, existing);
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 3, code: "duplicate_question" }),
      expect.objectContaining({ row: 4, matching_exam: "Target Exam" }),
      expect.objectContaining({ row: 5, matching_exam: "Other Exam" }),
    ]);
    expect(questionDuplicateSignature("written", "<p>Hello!</p>", [])).toBe(questionDuplicateSignature("written", "<p>HELLO</p>", []));
  });

  it("normalizes the full 50000-character question allowance instead of the helper default", () => {
    const prefix = "a".repeat(3_000);
    expect(questionDuplicateSignature("written", `<p>${prefix} one</p>`, [])).not.toBe(questionDuplicateSignature("written", `<p>${prefix} two</p>`, []));
  });

  it("allows an explicitly forced exact duplicate", () => {
    const rows = [row(2, { model_answer: "M" }), row(3, { model_answer: "M" })];
    expect(prepareQuestionImport(rows, examId, [], new Set([3])).ready).toHaveLength(2);
  });

  it("flags encoding damage and invalid marks", () => {
    const result = prepareQuestionImport([row(2, { question: "bad �" }), row(3, { question: "marks", model_answer: "M", marks: "1000" })], examId, []);
    expect(result.issues.map((item) => item.code)).toEqual(["encoding_damage", "invalid_marks"]);
  });

  it("handles a 200-row file and splits confirmed writes into small batches", () => {
    const rows = Array.from({ length: 200 }, (_, index) => row(index + 2, { question: `Question ${index}`, model_answer: `Model ${index}` }));
    expect(prepareQuestionImport(rows, examId, []).ready).toHaveLength(200);
    expect(questionImportBatches(rows).map((batch) => batch.length)).toEqual(Array(10).fill(20));
  });
});
