import { describe, expect, it, vi } from "vitest";

import {
  LifecycleRpcError,
  finalizeExamIfClosed,
  startExam,
  submitDueAttempt,
} from "./exam-lifecycle";

describe("exam lifecycle RPC wrappers", () => {
  it("calls the shared start RPC with the admin/worker mode", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ out_result: "started", out_status: "live", out_started_at: "start", out_ends_at: "end", out_missing: [] }],
      error: null,
    });

    await expect(startExam({ rpc }, "exam-1", true)).resolves.toMatchObject({ out_result: "started" });
    expect(rpc).toHaveBeenCalledWith("start_exam", {
      p_exam_id: "exam-1",
      p_scheduled_only: true,
    });
  });

  it("calls only the due-submission RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ out_result: "submitted", out_reason: "auto" }],
      error: null,
    });

    await expect(submitDueAttempt({ rpc }, "attempt-1")).resolves.toEqual({
      out_result: "submitted",
      out_reason: "auto",
    });
    expect(rpc).toHaveBeenCalledWith("submit_due_attempt", { p_attempt_id: "attempt-1" });
  });

  it("calls the database finalization authority", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ out_result: "finalized", out_exam_status: "finalized", out_finalized_attempts: 23 }],
      error: null,
    });

    await expect(finalizeExamIfClosed({ rpc }, "exam-1")).resolves.toMatchObject({
      out_result: "finalized",
      out_finalized_attempts: 23,
    });
    expect(rpc).toHaveBeenCalledWith("finalize_exam_if_closed", { p_exam_id: "exam-1" });
  });

  it("does not expose a database message in a wrapped failure", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "57014", message: "sensitive database detail" },
    });

    const failure = await startExam({ rpc }, "exam-1", false).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LifecycleRpcError);
    expect(failure).toMatchObject({ message: "start_exam_failed", code: "57014" });
    expect(String(failure)).not.toContain("sensitive database detail");
  });
});
