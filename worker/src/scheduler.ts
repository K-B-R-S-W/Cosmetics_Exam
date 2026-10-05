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

function errorCode(error: unknown): string {
  if (error instanceof LifecycleRpcError) return error.code;
  if (error instanceof SchedulerSourceError) return error.code;
  return "worker_error";
}

async function safeScan<T>(
  operation: string,
  scan: () => Promise<T[]>,
  logger: SchedulerLogger,
): Promise<T[]> {
  try {
    return await scan();
  } catch (error) {
    logger.error("scheduler_scan_failed", { result: operation, error_code: errorCode(error) });
    return [];
  }
}

export async function runSchedulerTick({ source, rpcClient, logger, now }: SchedulerDependencies): Promise<void> {
  const cutoff = new Date(now().getTime() + SCHEDULER_EARLY_WINDOW_MS);
  const [scheduledExams, dueAttempts, lifecycleExams] = await Promise.all([
    safeScan("scheduled", () => source.listScheduledExams(cutoff), logger),
    safeScan("attempts", () => source.listDueAttempts(cutoff), logger),
    safeScan("lifecycle", () => source.listLifecycleExams(cutoff), logger),
  ]);

  for (const exam of scheduledExams) {
    try {
      const result = await startExam(rpcClient, exam.id, true);
      if (result.out_result === "started") {
        logger.info("exam_started", { exam_id: exam.id, result: result.out_result });
      } else if (result.out_result === "not_ready") {
        logger.error("exam_start_not_ready", {
          exam_id: exam.id,
          missing: result.out_missing,
        });
      } else if (result.out_result === "not_found") {
        logger.error("exam_start_failed", { exam_id: exam.id, result: result.out_result });
      }
    } catch (error) {
      logger.error("exam_start_failed", { exam_id: exam.id, error_code: errorCode(error) });
    }
  }

  for (const attempt of dueAttempts) {
    try {
      const result = await submitDueAttempt(rpcClient, attempt.id);
      if (result.out_result === "submitted") {
        logger.info("attempt_submitted", {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
          result: result.out_result,
          reason: result.out_reason,
        });
      } else if (result.out_result === "not_found") {
        logger.error("attempt_submit_failed", {
          exam_id: attempt.exam_id,
          attempt_id: attempt.id,
          result: result.out_result,
        });
      }
    } catch (error) {
      logger.error("attempt_submit_failed", {
        exam_id: attempt.exam_id,
        attempt_id: attempt.id,
        error_code: errorCode(error),
      });
    }
  }

  for (const exam of lifecycleExams) {
    try {
      const result = await finalizeExamIfClosed(rpcClient, exam.id);
      if (result.out_result === "ended" || result.out_result === "finalized") {
        logger.info("exam_lifecycle_changed", {
          exam_id: exam.id,
          result: result.out_result,
          finalized_attempts: result.out_finalized_attempts,
        });
      } else if (result.out_result === "pending_attempts" || result.out_result === "not_found") {
        logger.error("exam_lifecycle_failed", { exam_id: exam.id, result: result.out_result });
      }
    } catch (error) {
      logger.error("exam_lifecycle_failed", { exam_id: exam.id, error_code: errorCode(error) });
    }
  }
}
