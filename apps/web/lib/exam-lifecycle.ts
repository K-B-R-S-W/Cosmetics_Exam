export type LifecycleRpcErrorShape = {
  code?: string;
  message?: string;
};

export interface LifecycleRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: LifecycleRpcErrorShape | null }>;
}

export class LifecycleRpcError extends Error {
  readonly operation: string;
  readonly code: string;

  constructor(operation: string, code?: string) {
    super(`${operation}_failed`);
    this.name = "LifecycleRpcError";
    this.operation = operation;
    this.code = code || "database_error";
  }
}

export type StartExamResult = {
  out_result: "started" | "not_due" | "not_ready" | "invalid_status" | "not_found";
  out_status: string | null;
  out_started_at: string | null;
  out_ends_at: string | null;
  out_missing: string[];
};

export type SubmitDueAttemptResult = {
  out_result: "submitted" | "already_submitted" | "not_due" | "not_found";
  out_reason: "auto" | "forced" | "manual" | null;
};

export type FinalizeExamResult = {
  out_result:
    | "ended"
    | "finalized"
    | "already_finalized"
    | "not_closed"
    | "pending_attempts"
    | "not_found";
  out_exam_status: string | null;
  out_finalized_attempts: number;
};

function oneRow<T>(operation: string, data: unknown, error: LifecycleRpcErrorShape | null): T {
  if (error) {
    throw new LifecycleRpcError(operation, error.code);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new LifecycleRpcError(operation, "invalid_response");
  }

  return row as T;
}

export async function startExam(
  client: LifecycleRpcClient,
  examId: string,
  scheduledOnly: boolean,
): Promise<StartExamResult> {
  const { data, error } = await client.rpc("start_exam", {
    p_exam_id: examId,
    p_scheduled_only: scheduledOnly,
  });
  return oneRow<StartExamResult>("start_exam", data, error);
}

export async function submitDueAttempt(
  client: LifecycleRpcClient,
  attemptId: string,
): Promise<SubmitDueAttemptResult> {
  const { data, error } = await client.rpc("submit_due_attempt", {
    p_attempt_id: attemptId,
  });
  return oneRow<SubmitDueAttemptResult>("submit_due_attempt", data, error);
}

export async function finalizeExamIfClosed(
  client: LifecycleRpcClient,
  examId: string,
): Promise<FinalizeExamResult> {
  const { data, error } = await client.rpc("finalize_exam_if_closed", {
    p_exam_id: examId,
  });
  return oneRow<FinalizeExamResult>("finalize_exam_if_closed", data, error);
}
