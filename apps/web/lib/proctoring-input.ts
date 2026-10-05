import { z } from "zod";
import { CLIENT_EVENT_TYPES } from "@/lib/proctoring-rules";

const uuid = z.string().uuid();
const metaSchema = z.record(z.string(), z.unknown()).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2048,
  "Metadata must be 2 KB or less.",
);

export const candidateEventSchema = z.object({
  id: uuid, type: z.enum(CLIENT_EVENT_TYPES), merged_types: z.array(z.enum(CLIENT_EVENT_TYPES)).max(10).default([]),
  occurred_ago_ms: z.number().int().min(0), duration_ms: z.number().int().min(0).nullable(), meta: metaSchema.nullable(),
  snapshot_jpeg_base64: z.string().max(140_000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.merged_types).size !== value.merged_types.length || value.merged_types.includes(value.type)) context.addIssue({ code: "custom", path: ["merged_types"], message: "Merged event types must be unique." });
});

export type CandidateEventInput = z.infer<typeof candidateEventSchema>;
export const heartbeatInputSchema = z.object({}).strict();
export const dismissEventSchema = z.object({ dismissed: z.boolean(), note: z.string().trim().min(1).max(300) }).strict();
