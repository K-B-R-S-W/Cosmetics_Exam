import { z } from "zod";
import type { PromptMapping } from "./prompt";

const responseItem = z.strictObject({
  item: z.string(), marks: z.number().finite(), reason: z.string(),
  matched_points: z.array(z.string()), missing_points: z.array(z.string()),
  incorrect_claims: z.array(z.string()), confidence: z.number().finite(),
  language: z.enum(["english", "sinhala", "mixed", "singlish"]),
  candidate_meaning_english: z.string(),
  verdict: z.enum(["correct", "partially_correct", "incorrect", "no_answer"]),
});

export type ValidatedScore = {
  questionId: string; marks: number; maxMarks: number; reason: string; needsReview: boolean;
  details: Record<string, unknown>;
};

export function roundMark(value: number, step = 0.5): number { return Math.round(value / step) * step; }

export function parseGradingResponse(text: string, mapping: PromptMapping[], options: { markStep?: number; reviewConfidence?: number; reviewConfidenceSinglish?: number; promptVersion?: string } = {}): { scores: ValidatedScore[]; missing: string[] } {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("invalid_grading_response");
  const scores: ValidatedScore[] = [];
  for (const candidate of raw) {
    const validated = responseItem.safeParse(candidate);
    if (!validated.success) continue;
    const item = validated.data;
    const map = mapping.find((entry) => entry.id === item.item);
    if (!map || scores.some((score) => score.questionId === map.questionId)) continue;
    const clampedMarks = Math.max(0, Math.min(map.maxMarks, item.marks));
    const marks = Math.max(0, Math.min(map.maxMarks, roundMark(clampedMarks, options.markStep ?? 0.5)));
    const confidence = Math.max(0, Math.min(1, item.confidence));
    const ratio = map.maxMarks > 0 ? marks / map.maxMarks : 0;
    const reviewReasons: string[] = [];
    if (confidence < (options.reviewConfidence ?? 0.6)) reviewReasons.push("low_confidence");
    if ((item.language === "singlish" || item.language === "mixed") && confidence < (options.reviewConfidenceSinglish ?? 0.75)) reviewReasons.push("low_confidence_singlish");
    if ((item.verdict === "correct" && ratio < 0.75) || (item.verdict === "incorrect" && ratio > 0.25) || (item.verdict === "partially_correct" && (ratio === 0 || ratio === 1))) reviewReasons.push("verdict_mismatch");
    if (item.verdict === "no_answer") reviewReasons.push("no_answer_on_nonblank");
    if ((item.matched_points.length === 0 && ratio > 0) || (item.matched_points.length > 0 && ratio === 0 && item.incorrect_claims.length === 0) || (item.incorrect_claims.length > 0 && ratio === 1)) reviewReasons.push("points_mismatch");
    if (item.marks !== clampedMarks) reviewReasons.push("clamped");
    if (map.truncated) reviewReasons.push("truncated_answer");
    if (!item.reason.trim()) reviewReasons.push("empty_reason");
    const trimArray = (values: string[]) => values.slice(0, 10).map((value) => value.slice(0, 300));
    scores.push({
      questionId: map.questionId, marks, maxMarks: map.maxMarks, reason: item.reason.slice(0, 400),
      needsReview: reviewReasons.length > 0,
      details: {
        matched_points: trimArray(item.matched_points), missing_points: trimArray(item.missing_points),
        incorrect_claims: trimArray(item.incorrect_claims), confidence,
        language: item.language, candidate_meaning_english: item.candidate_meaning_english,
        verdict: item.verdict, prompt_version: options.promptVersion ?? "g1", raw_marks: item.marks,
        adjusted: marks !== item.marks, clamped: item.marks !== clampedMarks,
        truncated: map.truncated, review_reasons: reviewReasons,
      },
    });
  }
  return { scores, missing: mapping.filter((map) => !scores.some((score) => score.questionId === map.questionId)).map((map) => map.questionId) };
}
