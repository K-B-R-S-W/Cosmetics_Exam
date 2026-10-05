import type { LifecycleRpcClient } from "../../apps/web/lib/exam-lifecycle";
import {
  LifecycleRpcError,
  finalizeExamIfClosed,
  startExam,
  submitDueAttempt,
} from "../../apps/web/lib/exam-lifecycle";

import { SCHEDULER_EARLY_WINDOW_MS } from "./config";
import type { SchedulerLogger } from "./logger";
import { SchedulerSourceError, type SchedulerSource } from "./supabase-source";

export type SchedulerDependencies = {
  source: SchedulerSource;
  rpcClient: LifecycleRpcClient;
  logger: SchedulerLogger;
  now: () => Date;
};

const CONDITION_REMINDER_MS = 5 * 60_000;

type ConditionRecord = {
  fingerprint: string;
  lastLoggedAt: number;
};

// The production worker has one logger instance, so this is one in-memory
// condition set per process. WeakMap keeps test logger instances isolated.
const conditionsByLogger = new WeakMap<SchedulerLogger, Map<string, ConditionRecord>>();

function conditionState(logger: SchedulerLogger): Map<string, ConditionRecord> {
  const existing = conditionsByLogger.get(logger);
  if (existing) return existing;
  const created = new Map<string, ConditionRecord>();
  conditionsByLogger.set(logger, created);
  return created;
}

function reportCondition(
  logger: SchedulerLogger,
  key: string,
  fingerprint: string,
  event: string,
  context: Parameters<SchedulerLogger["error"]>[1],
  nowMs: number,
): void {
  const state = conditionState(logger);
  const previous = state.get(key);
  if (
    !previous
    || previous.fingerprint !== fingerprint
    || nowMs - previous.lastLoggedAt >= CONDITION_REMINDER_MS
  ) {
    logger.error(event, context);
    state.set(key, { fingerprint, lastLoggedAt: nowMs });
  }
}

function recoverCondition(
  logger: SchedulerLogger,
  key: string,
  event: string,
  context: Parameters<SchedulerLogger["info"]>[1],
): void {
  if (conditionState(logger).delete(key)) logger.info(event, context);
}

function clearCondition(logger: SchedulerLogger, key: string): void {
  conditionState(logger).delete(key);
}

function recoverMissingItemConditions(
  logger: SchedulerLogger,
  prefix: string,
  activeIds: Set<string>,
  event: string,
  idField: "exam_id" | "attempt_id",
): void {
  const state = conditionState(logger);
  for (const key of [...state.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!activeIds.has(id)) {
      state.delete(key);
      logger.info(event, { [idField]: id });
    }
  }
}

function errorCode(error: unknown): string {
  if (error instanceof LifecycleRpcError) return error.code;
  if (error instanceof SchedulerSourceError) return error.code;
  return "worker_error";
}

async function safeScan<T>(
  operation: string,
  scan: () => Promise<T[]>,
  logger: SchedulerLogger,
  nowMs: number,
): Promise<{ rows: T[]; succeeded: boolean }> {
  const conditionKey = `scan:${operation}`;
  try {
    const rows = await scan();
    recoverCondition(logger, conditionKey, "scheduler_scan_recovered", { result: operation });
    return { rows, succeeded: true };
  } catch (error) {
    const code = errorCode(error);
    reportCondition(
      logger,
      conditionKey,
      code,
      "scheduler_scan_failed",
      { result: operation, error_code: code },
      nowMs,
    );
    return { rows: [], succeeded: false };
  }
}

export async function runSchedulerTick({ source, rpcClient, logger, now }: SchedulerDependencies): Promise<void> {
  const tickNow = now();
  const nowMs = tickNow.getTime();
  const cutoff = new Date(nowMs + SCHEDULER_EARLY_WINDOW_MS);
  const [scheduledScan, attemptScan, lifecycleScan] = await Promise.all([
    safeScan("scheduled", () => source.listScheduledExams(cutoff), logger, nowMs),
    safeScan("attempts", () => source.listDueAttempts(cutoff), logger, nowMs),
    safeScan("lifecycle", () => source.listLifecycleExams(cutoff), logger, nowMs),
  ]);
  const scheduledExams = scheduledScan.rows;
  const dueAttempts = attemptScan.rows;
  const lifecycleExams = lifecycleScan.rows;

  if (scheduledScan.succeeded) {
    const active = new Set(scheduledExams.map((exam) => exam.id));
    recoverMissingItemConditions(logger, "exam_start_failed:", active, "exam_start_recovered", "exam_id");
    for (const key of [...conditionState(logger).keys()]) {
      if (key.startsWith("exam_start_not_ready:") && !active.has(key.slice("exam_start_not_ready:".length))) {
        clearCondition(logger, key);
      }
    }
  }
  if (attemptScan.succeeded) {
    recoverMissingItemConditions(
      logger,
      "attempt_submit_failed:",
      new Set(dueAttempts.map((attempt) => attempt.id)),
      "attempt_submit_recovered",
      "attempt_id",
    );
  }
  if (lifecycleScan.succeeded) {
    recoverMissingItemConditions(
      logger,
      "exam_lifecycle_failed:",
      new Set(lifecycleExams.map((exam) => exam.id)),
      "exam_lifecycle_recovered",
      "exam_id",
    );
  }

  for (const exam of scheduledExams) {
    const failedKey = `exam_start_failed:${exam.id}`;
    const unreadyKey = `exam_start_not_ready:${exam.id}`;
    try {
      const result = await startExam(rpcClient, exam.id, true);
      if (result.out_result === "started") {
        recoverCondition(logger, failedKey, "exam_start_recovered", { exam_id: exam.id });
        clearCondition(logger, unreadyKey);
        logger.info("exam_started", { exam_id: exam.id, result: result.out_result });
      } else if (result.out_result === "not_ready") {
        recoverCondition(logger, failedKey, "exam_start_recovered", { exam_id: exam.id });
        const missing = [...new Set(result.out_missing)].sort();
        reportCondition(
          logger,
          unreadyKey,
          missing.join(","),
          "exam_start_not_ready",
          { exam_id: exam.id, missing },
          nowMs,
        );
      } else if (result.out_result === "not_found") {
        clearCondition(logger, unreadyKey);
        reportCondition(
          logger,
          failedKey,
          result.out_result,
          "exam_start_failed",
          { exam_id: exam.id, result: result.out_result },
          nowMs,
        );
      } else {
        recoverCondition(logger, failedKey, "exam_start_recovered", { exam_id: exam.id });
        clearCondition(logger, unreadyKey);
      }
    } catch (error) {
      const code = errorCode(error);
      reportCondition(
        logger,
        failedKey,
        code,
        "exam_start_failed",
        { exam_id: exam.id, error_code: code },
        nowMs,
      );
    }
  }

  for (const attempt of dueAttempts) {
    const failedKey = `attempt_submit_failed:${attempt.id}`;
    try {
      const result = await submitDueAttempt(rpcClient, attempt.id);
      if (result.out_result === "submitted") {
        recoverCondition(logger, failedKey, "attempt_submit_recovered", {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
        });
        logger.info("attempt_submitted", {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
          result: result.out_result,
          reason: result.out_reason,
        });
      } else if (result.out_result === "not_found") {
        reportCondition(
          logger,
          failedKey,
          result.out_result,
          "attempt_submit_failed",
          {
            exam_id: attempt.exam_id,
            attempt_id: attempt.id,
            result: result.out_result,
          },
          nowMs,
        );
      } else {
        recoverCondition(logger, failedKey, "attempt_submit_recovered", {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
        });
      }
    } catch (error) {
      const code = errorCode(error);
      reportCondition(
        logger,
        failedKey,
        code,
        "attempt_submit_failed",
        {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
          error_code: code,
        },
        nowMs,
      );
    }
  }

  for (const exam of lifecycleExams) {
    const failedKey = `exam_lifecycle_failed:${exam.id}`;
    try {
      const result = await finalizeExamIfClosed(rpcClient, exam.id);
      if (result.out_result === "ended" || result.out_result === "finalized") {
        recoverCondition(logger, failedKey, "exam_lifecycle_recovered", { exam_id: exam.id });
        logger.info("exam_lifecycle_changed", {
          exam_id: exam.id,
          result: result.out_result,
          finalized_attempts: result.out_finalized_attempts,
        });
      } else if (result.out_result === "pending_attempts" || result.out_result === "not_found") {
        reportCondition(
          logger,
          failedKey,
          result.out_result,
          "exam_lifecycle_failed",
          { exam_id: exam.id, result: result.out_result },
          nowMs,
        );
      } else {
        recoverCondition(logger, failedKey, "exam_lifecycle_recovered", { exam_id: exam.id });
      }
    } catch (error) {
      const code = errorCode(error);
      reportCondition(
        logger,
        failedKey,
        code,
        "exam_lifecycle_failed",
        { exam_id: exam.id, error_code: code },
        nowMs,
      );
    }
  }
}
