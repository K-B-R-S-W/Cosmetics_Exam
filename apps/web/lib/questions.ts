import sanitizeHtml from "sanitize-html";
import { z } from "zod";

export const QUESTION_BODY_MAX = 50_000;
export const OPTION_TEXT_MAX = 5_000;
export const QUESTION_REQUEST_MAX_BYTES = 200 * 1024;
export const QUESTION_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const QUESTION_IMAGE_MAX_PIXELS = 25_000_000;
export const QUESTION_IMAGE_LONG_EDGE = 1_600;

const uuidSchema = z.string().uuid();
const nullableText = (max: number) => z.string().max(max).nullable();
const marksSchema = z.number().finite().gt(0).max(999.99).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Marks may have at most two decimal places.",
);
const calibrationMarkSchema = z.number().finite().min(0).max(999.99).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Marks may have at most two decimal places.",
);

export const questionImageSchema = z.object({
  path: z.string().trim().min(1).max(1_000).regex(/^questions\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/),
  alt_text: z.string().trim().min(1).max(500),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size_bytes: z.number().int().min(1).max(QUESTION_IMAGE_MAX_BYTES),
}).strict();

export const calibrationItemSchema = z.object({
  answer: z.string().max(20_000),
  marks: calibrationMarkSchema,
  note: z.string().max(4_000),
}).strict();

export const answerKeySchema = z.object({
  correct_option_id: uuidSchema.nullable().default(null),
  model_answer: nullableText(10_000).default(null),
  grading_notes: nullableText(4_000).default(null),
  calibration: z.array(calibrationItemSchema).max(10).default([]),
}).strict();

export const questionOptionSchema = z.object({
  id: uuidSchema,
  text_html: z.string().trim().min(1).max(OPTION_TEXT_MAX),
}).strict();

const questionDocumentShape = {
  body_html: z.string().trim().min(1).max(QUESTION_BODY_MAX),
  marks: marksSchema.optional().default(1),
  image: questionImageSchema.nullable().default(null),
  options: z.array(questionOptionSchema).max(10).default([]),
  answer_key: answerKeySchema,
};

export const createQuestionSchema = z.object({
  id: uuidSchema,
  exam_id: uuidSchema,
  type: z.enum(["mcq", "written"]),
  position: z.number().int().min(0).nullable().optional().default(null),
  ...questionDocumentShape,
}).strict().superRefine(validateQuestionDocument);

export const updateQuestionSchema = z.object({
  body_html: questionDocumentShape.body_html.optional(),
  marks: marksSchema.optional(),
  image: questionImageSchema.nullable().optional(),
  options: z.array(questionOptionSchema).max(10).optional(),
  answer_key: answerKeySchema.optional(),
  type: z.enum(["mcq", "written"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field.");

export const reorderQuestionsSchema = z.object({
  exam_id: uuidSchema,
  ordered_ids: z.array(uuidSchema).max(1_000),
}).strict().superRefine((value, context) => {
  if (new Set(value.ordered_ids).size !== value.ordered_ids.length) {
    context.addIssue({ code: "custom", path: ["ordered_ids"], message: "Question IDs must be unique." });
  }
});

export const answerKeyMutationSchema = z.object({
  question_id: uuidSchema,
  ...answerKeySchema.shape,
}).strict();

export const questionIdSchema = uuidSchema;
export const examIdQuerySchema = uuidSchema;

export type QuestionImage = z.infer<typeof questionImageSchema>;
export type AnswerKeyInput = z.infer<typeof answerKeySchema>;
export type QuestionOptionInput = z.infer<typeof questionOptionSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export interface CompleteQuestionDocument {
  id: string;
  exam_id: string;
  type: "mcq" | "written";
  position: number | null;
  body_html: string;
  marks: number;
  image: QuestionImage | null;
  options: QuestionOptionInput[];
  answer_key: AnswerKeyInput;
}

function validateQuestionDocument(
  value: {
    type: "mcq" | "written";
    options: QuestionOptionInput[];
    answer_key: AnswerKeyInput;
  },
  context: z.RefinementCtx,
): void {
  const key = value.answer_key;
  if (value.type === "mcq") {
    if (value.options.length < 2 || value.options.length > 10) {
      context.addIssue({ code: "custom", path: ["options"], message: "MCQ questions need 2 to 10 options." });
    }
    if (new Set(value.options.map((option) => option.id)).size !== value.options.length) {
      context.addIssue({ code: "custom", path: ["options"], message: "Option IDs must be unique." });
    }
    if (!key.correct_option_id || !value.options.some((option) => option.id === key.correct_option_id)) {
      context.addIssue({ code: "custom", path: ["answer_key", "correct_option_id"], message: "Choose one of this question's options." });
    }
    if (key.model_answer !== null || key.grading_notes !== null || key.calibration.length > 0) {
      context.addIssue({ code: "custom", path: ["answer_key"], message: "MCQ keys may only contain the correct option." });
    }
  } else {
    if (value.options.length > 0 || key.correct_option_id !== null) {
      context.addIssue({ code: "custom", path: ["options"], message: "Written questions cannot have MCQ options." });
    }
  }
}

const QUESTION_ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "span", "h2", "h3"];

const baseSanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: QUESTION_ALLOWED_TAGS,
  allowedAttributes: { span: ["style"] },
  allowedStyles: { span: { "font-size": [/^\d{1,3}(?:px|em|rem|%)$/] } },
  disallowedTagsMode: "discard",
};

export function sanitizeQuestionHtml(value: string): string {
  return sanitizeHtml(value, baseSanitizeOptions).trim();
}

export function sanitizeOptionHtml(value: string): string {
  return sanitizeHtml(value, {
    ...baseSanitizeOptions,
    allowedTags: QUESTION_ALLOWED_TAGS.filter((tag) => tag !== "h2" && tag !== "h3"),
  }).trim();
}

export function sanitizeCompleteQuestion(document: CompleteQuestionDocument): CompleteQuestionDocument {
  const sanitized = {
    ...document,
    body_html: sanitizeQuestionHtml(document.body_html),
    options: document.options.map((option) => ({ ...option, text_html: sanitizeOptionHtml(option.text_html) })),
  };
  return createQuestionSchema.parse(sanitized);
}
