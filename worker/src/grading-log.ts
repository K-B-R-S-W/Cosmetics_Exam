export const SAFE_GRADING_EVENTS = new Set([
  "worker_start", "call", "done", "rate_limited", "key_disabled", "retry", "requeued",
  "blocked", "paused", "resumed", "run_done", "run_failed",
]);

export type GradingLogRow = {
  run_id: string | null; job_id?: string | null; key_label?: string | null;
  model?: string | null; event: string; detail?: string | null;
};

export function safeGradingDetail(fields: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(fields).filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`).join(",");
}

export function validateGradingLog(row: GradingLogRow): GradingLogRow {
  if (!SAFE_GRADING_EVENTS.has(row.event)) throw new Error("unsafe_grading_event");
  if (row.key_label && !/^key[1-3]$/u.test(row.key_label)) throw new Error("unsafe_key_label");
  if (row.detail && !/^(?:[a-z_]+=[a-z0-9_.:+-]+)(?:,[a-z_]+=[a-z0-9_.:+-]+)*$/iu.test(row.detail)) throw new Error("unsafe_grading_detail");
  return row;
}
