export interface KeyCompletenessQuestion {
  type: "mcq" | "written";
  options: Array<{ id: string }>;
  answer_key: { correct_option_id: string | null; model_answer: string | null };
}

export function questionKeyComplete<T extends KeyCompletenessQuestion>(question: T): boolean {
  return question.type === "mcq"
    ? Boolean(question.answer_key.correct_option_id && question.options.some((option) => option.id === question.answer_key.correct_option_id))
    : Boolean(question.answer_key.model_answer?.trim());
}
