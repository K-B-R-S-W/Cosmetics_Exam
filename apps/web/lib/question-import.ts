import { gradingHtmlToText } from "@/lib/grading/html-to-text";
import {
  OPTION_TEXT_MAX,
  QUESTION_BODY_MAX,
  createQuestionSchema,
  type CompleteQuestionDocument,
} from "@/lib/questions";

export const QUESTION_IMPORT_LIMIT = 200;
export const QUESTION_IMPORT_BATCH_SIZE = 20;
export const QUESTION_IMPORT_COLUMNS = [
  "type", "question", "option_a", "option_b", "option_c", "option_d", "option_e",
  "option_f", "option_g", "option_h", "option_i", "option_j", "correct", "marks",
  "model_answer", "grading_notes",
] as const;

export type QuestionImportRow = Record<(typeof QUESTION_IMPORT_COLUMNS)[number], string> & { source_row: number };
export type ExistingQuestionForImport = {
  exam_id: string;
  exam_title: string;
  type: "mcq" | "written";
  body_html: string;
  option_html: string[];
};
export type QuestionImportIssue = {
  row: number;
  code: string;
  message: string;
  can_force?: boolean;
  matching_exam?: string;
};
export type PreparedQuestionImport = { row: number; document: CompleteQuestionDocument };

const OPTION_KEYS = QUESTION_IMPORT_COLUMNS.filter((column) => column.startsWith("option_"));

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function plainTextToEditorHtml(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`).join("");
}

export function normalizeQuestionText(html: string, maxLength: number): string {
  return gradingHtmlToText(html, maxLength)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function questionDuplicateSignature(type: "mcq" | "written", bodyHtml: string, options: string[]): string {
  const body = normalizeQuestionText(bodyHtml, QUESTION_BODY_MAX);
  if (type === "written") return `written|${body}`;
  const optionSet = options.map((value) => normalizeQuestionText(value, OPTION_TEXT_MAX)).sort().join("|");
  return `mcq|${body}|${optionSet}`;
}

function damage(values: string[]): boolean {
  return values.some((value) => value.includes("\uFFFD") || /\?{3,}/.test(value));
}

function issue(row: number, code: string, message: string): QuestionImportIssue {
  return { row, code, message };
}

function parseRow(row: QuestionImportRow, examId: string): PreparedQuestionImport | QuestionImportIssue {
  const question = row.question.trim();
  if (!question) return issue(row.source_row, "missing_question", "Question text is required.");
  if (question.length > QUESTION_BODY_MAX) return issue(row.source_row, "question_too_long", `Question text cannot exceed ${QUESTION_BODY_MAX} characters.`);
  const values = QUESTION_IMPORT_COLUMNS.map((column) => row[column] ?? "");
  if (damage(values)) return issue(row.source_row, "encoding_damage", "This row may contain damaged text. Re-save the file as CSV UTF-8.");

  const optionEntries = OPTION_KEYS.map((key, index) => ({ letter: String.fromCharCode(65 + index), text: row[key].trim() })).filter((item) => item.text);
  const requestedType = row.type.trim().toLowerCase();
  if (requestedType && requestedType !== "mcq" && requestedType !== "written") return issue(row.source_row, "invalid_type", "Type must be mcq or written.");
  const type = (requestedType || (optionEntries.length > 0 ? "mcq" : "written")) as "mcq" | "written";
  const marks = row.marks.trim() ? Number(row.marks) : 1;
  if (!Number.isFinite(marks) || marks <= 0 || marks > 999.99 || Math.abs(marks * 100 - Math.round(marks * 100)) > 1e-8) return issue(row.source_row, "invalid_marks", "Marks must be from 0.01 to 999.99 with at most two decimal places.");

  if (type === "mcq") {
    if (optionEntries.length < 2) return issue(row.source_row, "too_few_options", "MCQ questions need at least two options.");
    if (optionEntries.some((item) => item.text.length > OPTION_TEXT_MAX)) return issue(row.source_row, "option_too_long", `Options cannot exceed ${OPTION_TEXT_MAX} characters.`);
    const correct = row.correct.trim();
    const matching = /^[a-j]$/i.test(correct)
      ? optionEntries.find((item) => item.letter === correct.toUpperCase())
      : optionEntries.find((item) => item.text === correct);
    if (!correct || !matching) return issue(row.source_row, "invalid_correct", "Correct must be a filled option letter or the exact option text.");
    const options = optionEntries.map((item) => ({ id: crypto.randomUUID(), text_html: plainTextToEditorHtml(item.text) }));
    const correctIndex = optionEntries.indexOf(matching);
    return { row: row.source_row, document: createQuestionSchema.parse({
      id: crypto.randomUUID(), exam_id: examId, type, position: null,
      body_html: plainTextToEditorHtml(question), marks, image: null, options,
      answer_key: { correct_option_id: options[correctIndex]!.id, model_answer: null, grading_notes: null, calibration: [] },
    }) };
  }

  if (optionEntries.length > 0) return issue(row.source_row, "written_has_options", "Written questions cannot contain options.");
  const modelAnswer = row.model_answer.trim();
  if (!modelAnswer) return issue(row.source_row, "missing_model_answer", "A written question requires a model answer.");
  if (modelAnswer.length > 10_000) return issue(row.source_row, "model_answer_too_long", "Model answer cannot exceed 10000 characters.");
  if (row.grading_notes.length > 4_000) return issue(row.source_row, "grading_notes_too_long", "Grading notes cannot exceed 4000 characters.");
  return { row: row.source_row, document: createQuestionSchema.parse({
    id: crypto.randomUUID(), exam_id: examId, type, position: null,
    body_html: plainTextToEditorHtml(question), marks, image: null, options: [],
    answer_key: { correct_option_id: null, model_answer: modelAnswer, grading_notes: row.grading_notes.trim() || null, calibration: [] },
  }) };
}

export function prepareQuestionImport(
  rows: QuestionImportRow[],
  examId: string,
  existing: ExistingQuestionForImport[],
  forceRows = new Set<number>(),
): { ready: PreparedQuestionImport[]; issues: QuestionImportIssue[] } {
  const ready: PreparedQuestionImport[] = [];
  const issues: QuestionImportIssue[] = [];
  const seen = new Map<string, number>();
  const existingBySignature = new Map(existing.map((item) => [
    questionDuplicateSignature(item.type, item.body_html, item.option_html), item,
  ]));

  for (const row of rows) {
    const parsed = parseRow(row, examId);
    if ("code" in parsed) { issues.push(parsed); continue; }
    const signature = questionDuplicateSignature(parsed.document.type, parsed.document.body_html, parsed.document.options.map((option) => option.text_html));
    const earlier = seen.get(signature);
    const match = existingBySignature.get(signature);
    if (!forceRows.has(row.source_row) && (earlier !== undefined || match)) {
      issues.push({
        row: row.source_row,
        code: "duplicate_question",
        message: earlier !== undefined ? `Duplicate of CSV row ${earlier}.` : `Duplicate of a question in ${match!.exam_title}.`,
        can_force: true,
        matching_exam: match?.exam_title,
      });
      seen.set(signature, earlier ?? row.source_row);
      continue;
    }
    seen.set(signature, earlier ?? row.source_row);
    ready.push(parsed);
  }
  return { ready, issues };
}

export function questionImportBatches<T>(rows: T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += QUESTION_IMPORT_BATCH_SIZE) batches.push(rows.slice(index, index + QUESTION_IMPORT_BATCH_SIZE));
  return batches;
}
