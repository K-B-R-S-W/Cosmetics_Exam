import { z } from "zod";

const nullableUuid = z.uuid().nullable();

export const answerInputSchema = z.object({
  question_id: z.uuid(),
  answer_text: z.string().max(20_000).nullable(),
  selected_option_id: nullableUuid,
  flagged: z.boolean(),
  revision: z.number().int().min(1),
}).strict();

export const nextInputSchema = z.object({
  expected_position: z.number().int().min(0),
  question_id: z.uuid(),
  answer_text: z.string().max(20_000).nullable(),
  selected_option_id: nullableUuid,
  revision: z.number().int().min(1),
}).strict();

export const submitInputSchema = z.object({
  reason: z.enum(["manual", "auto"]).default("manual"),
  pending_answers: z.array(answerInputSchema).max(200).default([]),
}).strict();
