import "server-only";
import { ApiError } from "@/lib/api";
import { documentedRpcDetails, gradingRpcStatus } from "./contracts";

export function throwGradingRpcError(error: { message?: string; details?: string | null }): never {
  const code = error.message ?? "";
  const status = gradingRpcStatus(code);
  if (status) {
    const messages: Record<string, string> = {
      validation_failed: "Check the request and try again.", not_found: "The requested record was not found.",
      exam_not_finalized: "Finalize the exam before grading.", not_finalized: "The attempt is not finalized.",
      grading_in_progress: "Another grading run is active.", regrade_in_progress: "This answer is already queued for regrading.",
      missing_answer_keys: "Complete every answer key before grading.", missing_answer_key: "This question needs a model answer.",
      nothing_to_grade: "This answer has no written response to grade.", not_resumable: "This grading run cannot be resumed.",
      not_written: "Only written questions can be regraded.",
    };
    throw new ApiError(code, status, messages[code] ?? "The grading request could not be completed.", documentedRpcDetails(code, error.details));
  }
  throw new Error("grading_database_error");
}
