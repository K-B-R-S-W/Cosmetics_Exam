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
