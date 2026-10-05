import { z } from "zod";
import { ApiError } from "@/lib/api";
import { CLIENT_EVENT_TYPES } from "@/lib/proctoring-rules";
import type { StateBody } from "@/lib/candidate-types";

const uuid = z.string().uuid();
const metaSchema = z.record(z.string(), z.unknown()).refine(
  (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2048,
  "Metadata must be 2 KB or less.",
);

export const candidateEventSchema = z.object({
  id: uuid,
  type: z.enum(CLIENT_EVENT_TYPES),
  merged_types: z.array(z.enum(CLIENT_EVENT_TYPES)).max(10).default([]),
  occurred_ago_ms: z.number().int().min(0),
  duration_ms: z.number().int().min(0).nullable(),
  meta: metaSchema.nullable(),
  snapshot_jpeg_base64: z.string().max(140_000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.merged_types).size !== value.merged_types.length || value.merged_types.includes(value.type)) {
    context.addIssue({ code: "custom", path: ["merged_types"], message: "Merged event types must be unique." });
  }
});

export type CandidateEventInput = z.infer<typeof candidateEventSchema>;

export const heartbeatInputSchema = z.object({}).strict();
export const dismissEventSchema = z.object({
  dismissed: z.boolean(),
  note: z.string().trim().min(1).max(300),
}).strict();

const stateSchema = z.object({
  server_time: z.union([z.string(), z.date()]),
  phase: z.enum(["waiting", "live", "submitted", "closed"]),
  exam: z.object({
    id: uuid, title: z.string(), status: z.enum(["draft", "scheduled", "live", "ended", "finalized"]),
    navigation_mode: z.enum(["free", "sequential"]),
    scheduled_start_at: z.union([z.string(), z.date()]).nullable(),
    started_at: z.union([z.string(), z.date()]).nullable(),
    ends_at: z.union([z.string(), z.date()]).nullable(),
    force_ended: z.boolean(), question_count: z.number().int().nonnegative(),
  }),
  attempt: z.object({
    id: uuid, status: z.enum(["not_started", "acknowledged", "in_progress", "submitted", "finalized"]),
    current_position: z.number().int().nonnegative(), extra_minutes: z.number().int().nonnegative(),
    deadline: z.union([z.string(), z.date()]).nullable(), submit_reason: z.enum(["manual", "auto", "forced"]).nullable(),
  }),
  announcements: z.array(z.object({ id: uuid, sent_at: z.union([z.string(), z.date()]) })),
});

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApiError("internal_error", 500, "Something went wrong. Try again.");
  return date.toISOString();
}

export function normalizeHeartbeatState(value: unknown): StateBody {
  const parsed = stateSchema.parse(value);
  return {
    ...parsed,
    server_time: iso(parsed.server_time)!,
    exam: {
      ...parsed.exam,
      scheduled_start_at: iso(parsed.exam.scheduled_start_at),
      started_at: iso(parsed.exam.started_at),
      ends_at: iso(parsed.exam.ends_at),
    },
    attempt: { ...parsed.attempt, deadline: iso(parsed.attempt.deadline) },
    announcements: parsed.announcements.map((item) => ({ ...item, sent_at: iso(item.sent_at)! })),
  };
}

export function rpcRow<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function throwHeartbeatResult(result: string): never {
  if (result === "unauthenticated") throw new ApiError("unauthenticated", 401, "Please sign in to continue.");
  if (result === "session_revoked") throw new ApiError("session_revoked", 401, "This session is no longer active.");
  throw new Error("heartbeat_rpc_failed");
}
