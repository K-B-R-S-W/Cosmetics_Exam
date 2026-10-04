import type { AnswerKeyInput, QuestionImage } from "@/lib/questions";

export interface EditorOption {
  id: string;
  position?: number;
  label?: string;
  text_html: string;
}

export interface EditorQuestion {
  id: string;
  exam_id: string;
  position: number | null;
  type: "mcq" | "written";
  body_html: string;
  marks: number;
  image: (QuestionImage & { preview_url?: string; image_missing?: true }) | null;
  options: EditorOption[];
  answer_key: AnswerKeyInput;
  persisted: boolean;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export type QuestionFieldErrors = Record<string, string>;

export function questionFieldErrors(details: unknown): QuestionFieldErrors {
  if (!Array.isArray(details)) return {};
  const errors: QuestionFieldErrors = {};
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const { path, message } = detail as { path?: unknown; message?: unknown };
    if (typeof path !== "string" || typeof message !== "string") continue;
    const option = /^options\.(\d+)\.text_html$/.exec(path);
    if (option) errors[path] = `Option ${String.fromCharCode(65 + Number(option[1]))} needs text.`;
    else if (path === "body_html") errors[path] = "Question text is empty.";
    else if (/^answer_key\.calibration\.\d+\.marks$/.test(path)) errors[path] = "Calibration marks cannot exceed the question marks.";
    else if (path === "answer_key.correct_option_id") errors[path] = "Choose the correct answer.";
    else errors[path] = message;
  }
  return errors;
}
