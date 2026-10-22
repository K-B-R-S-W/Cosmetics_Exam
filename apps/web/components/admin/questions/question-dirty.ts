import type { EditorQuestion } from "./question-types";

function normalizedQuestion(question: EditorQuestion, marks: number) {
  return {
    id: question.id,
    exam_id: question.exam_id,
    position: question.position,
    type: question.type,
    body_html: question.body_html,
    marks,
    image: question.image
      ? {
          path: question.image.path,
          alt_text: question.image.alt_text,
          mime: question.image.mime,
          size_bytes: question.image.size_bytes,
        }
      : null,
    options: question.options.map(({ id, text_html }) => ({ id, text_html })),
    answer_key: {
      correct_option_id: question.answer_key.correct_option_id ?? null,
      model_answer: question.answer_key.model_answer ?? null,
      grading_notes: question.answer_key.grading_notes ?? null,
      calibration: question.answer_key.calibration.map((example) => ({
        answer: example.answer,
        marks: example.marks,
        note: example.note,
      })),
    },
  };
}

export function questionsEqual(
  left: EditorQuestion,
  right: EditorQuestion,
): boolean {
  return (
    JSON.stringify(normalizedQuestion(left, left.marks)) ===
    JSON.stringify(normalizedQuestion(right, right.marks))
  );
}

export function questionIsDirty(
  current: EditorQuestion | undefined,
  saved: EditorQuestion | undefined,
  marksInput: string,
): boolean {
  if (!current) return false;
  if (!saved) return true;
  const marks = marksInput.trim() ? Number(marksInput) : 1;
  return (
    JSON.stringify(normalizedQuestion(current, marks)) !==
    JSON.stringify(normalizedQuestion(saved, saved.marks))
  );
}
