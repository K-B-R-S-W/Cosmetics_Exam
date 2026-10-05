import { describe, expect, it, vi } from "vitest";

import type { LifecycleRpcClient } from "../../apps/web/lib/exam-lifecycle";
import { schedulerLogger, type SchedulerLogger, type SchedulerLogContext } from "./logger";
import { runSchedulerTick } from "./scheduler";
import { SchedulerSourceError, type SchedulerSource } from "./supabase-source";

type LogEntry = { event: string; context: SchedulerLogContext };

function memoryLogger() {
  const info: LogEntry[] = [];
  const error: LogEntry[] = [];
  const logger: SchedulerLogger = {
    info: (event, context) => info.push({ event, context }),
    error: (event, context) => error.push({ event, context }),
  };
  return { logger, info, error };
}

function source(overrides: Partial<SchedulerSource> = {}): SchedulerSource {
  return {
    listScheduledExams: vi.fn().mockResolvedValue([]),
    listDueAttempts: vi.fn().mockResolvedValue([]),
    listLifecycleExams: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function client(handler: (name: string, args: Record<string, unknown>) => unknown): LifecycleRpcClient {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      data: [handler(name, args)],
      error: null,
    })),
  };
}

const now = () => new Date("2030-01-01T00:00:00.000Z");

describe("runSchedulerTick", () => {
  it("submits ordinary and force-ended attempts of every open status without answer writes", async () => {
    const scans = source({
      listDueAttempts: vi.fn().mockResolvedValue([
        { id: "not-started", exam_id: "ordinary", status: "not_started", extra_minutes: 0 },
        { id: "acknowledged", exam_id: "ordinary", status: "acknowledged", extra_minutes: 0 },
        { id: "in-progress", exam_id: "ordinary", status: "in_progress", extra_minutes: 0 },
        { id: "forced-not-started", exam_id: "forced", status: "not_started", extra_minutes: 25 },
        { id: "forced-acknowledged", exam_id: "forced", status: "acknowledged", extra_minutes: 25 },
        { id: "forced-in-progress", exam_id: "forced", status: "in_progress", extra_minutes: 25 },
      ]),
    });
    const rpcClient = client((name, args) => {
      if (name !== "submit_due_attempt") throw new Error("unexpected RPC");
      return {
        out_result: "submitted",
        out_reason: String(args.p_attempt_id).startsWith("forced-") ? "forced" : "auto",
      };
    });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(rpcClient.rpc).toHaveBeenCalledTimes(6);
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(1, "submit_due_attempt", { p_attempt_id: "not-started" });
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(2, "submit_due_attempt", { p_attempt_id: "acknowledged" });
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(3, "submit_due_attempt", { p_attempt_id: "in-progress" });
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(4, "submit_due_attempt", { p_attempt_id: "forced-not-started" });
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(5, "submit_due_attempt", { p_attempt_id: "forced-acknowledged" });
    expect(rpcClient.rpc).toHaveBeenNthCalledWith(6, "submit_due_attempt", { p_attempt_id: "forced-in-progress" });
    expect(logs.info.map((entry) => entry.context.reason)).toEqual([
      "auto", "auto", "auto", "forced", "forced", "forced",
    ]);
    expect(JSON.stringify((rpcClient.rpc as ReturnType<typeof vi.fn>).mock.calls)).not.toContain("answer");
  });

  it("retries an unready scheduled exam every tick and logs only its id and missing categories", async () => {
    const scans = source({ listScheduledExams: vi.fn().mockResolvedValue([{ id: "exam-unready" }]) });
    const rpcClient = client(() => ({
      out_result: "not_ready",
      out_status: "scheduled",
      out_started_at: null,
      out_ends_at: null,
      out_missing: ["questions", "candidates"],
    }));
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });
    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(rpcClient.rpc).toHaveBeenCalledTimes(2);
    expect(logs.error).toEqual([
      {
        event: "exam_start_not_ready",
        context: { exam_id: "exam-unready", missing: ["questions", "candidates"] },
      },
      {
        event: "exam_start_not_ready",
        context: { exam_id: "exam-unready", missing: ["questions", "candidates"] },
      },
    ]);
  });

  it("never calls start_exam for an ended lifecycle candidate", async () => {
    const scans = source({ listLifecycleExams: vi.fn().mockResolvedValue([{ id: "ended-exam" }]) });
    const rpcClient = client((name) => {
      expect(name).toBe("finalize_exam_if_closed");
      return { out_result: "finalized", out_exam_status: "finalized", out_finalized_attempts: 1 };
    });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(rpcClient.rpc).not.toHaveBeenCalledWith("start_exam", expect.anything());
    expect(logs.info).toHaveLength(1);
  });

  it("continues after one RPC fails", async () => {
    const scans = source({
      listDueAttempts: vi.fn().mockResolvedValue([
        { id: "bad", exam_id: "exam-1", status: "in_progress", extra_minutes: 0 },
        { id: "good", exam_id: "exam-1", status: "acknowledged", extra_minutes: 0 },
      ]),
    });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "57014", message: "do not log this" } })
      .mockResolvedValueOnce({ data: [{ out_result: "submitted", out_reason: "auto" }], error: null });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient: { rpc }, logger: logs.logger, now });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(logs.error[0]).toEqual({
      event: "attempt_submit_failed",
      context: { exam_id: "exam-1", attempt_id: "bad", error_code: "57014" },
    });
    expect(logs.info[0]?.context).toMatchObject({ attempt_id: "good", reason: "auto" });
    expect(JSON.stringify(logs)).not.toContain("do not log this");
  });

  it("emits no routine log for an idle tick or idempotent no-change outcomes", async () => {
    const scans = source({
      listScheduledExams: vi.fn().mockResolvedValue([{ id: "start-race" }]),
      listDueAttempts: vi.fn().mockResolvedValue([
        { id: "submitted-first", exam_id: "exam-1", status: "in_progress", extra_minutes: 0 },
      ]),
      listLifecycleExams: vi.fn().mockResolvedValue([{ id: "not-closed" }]),
    });
    const rpcClient = client((name) => {
      if (name === "start_exam") return { out_result: "invalid_status", out_missing: [] };
      if (name === "submit_due_attempt") return { out_result: "already_submitted", out_reason: "manual" };
      return { out_result: "not_closed", out_exam_status: "live", out_finalized_attempts: 0 };
    });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(logs.info).toEqual([]);
    expect(logs.error).toEqual([]);
  });

  it("handles not_due and already_submitted silently without counting a failure", async () => {
    const scans = source({
      listDueAttempts: vi.fn().mockResolvedValue([
        { id: "early", exam_id: "exam-1", status: "in_progress", extra_minutes: 0 },
        { id: "candidate-won", exam_id: "exam-1", status: "in_progress", extra_minutes: 0 },
      ]),
    });
    const rpcClient = client((_name, args) => args.p_attempt_id === "early"
      ? { out_result: "not_due", out_reason: null }
      : { out_result: "already_submitted", out_reason: "manual" });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(logs.info).toEqual([]);
    expect(logs.error).toEqual([]);
  });

  it("remains safe when two ticks overlap and the second observes idempotent outcomes", async () => {
    const scans = source({ listScheduledExams: vi.fn().mockResolvedValue([{ id: "exam-1" }]) });
    let calls = 0;
    const rpcClient = client(() => ({
      out_result: calls++ === 0 ? "started" : "invalid_status",
      out_status: "live",
      out_started_at: "2030-01-01T00:00:00Z",
      out_ends_at: "2030-01-01T01:00:00Z",
      out_missing: [],
    }));
    const logs = memoryLogger();

    await Promise.all([
      runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now }),
      runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now }),
    ]);

    expect(rpcClient.rpc).toHaveBeenCalledTimes(2);
    expect(logs.info).toEqual([
      { event: "exam_started", context: { exam_id: "exam-1", result: "started" } },
    ]);
    expect(logs.error).toEqual([]);
  });

  it("isolates scan failures so the remaining scans still run", async () => {
    const scans = source({
      listScheduledExams: vi.fn().mockRejectedValue(new SchedulerSourceError("scheduled_scan", "PGRST000")),
      listDueAttempts: vi.fn().mockResolvedValue([
        { id: "attempt-1", exam_id: "exam-1", status: "not_started", extra_minutes: 0 },
      ]),
    });
    const rpcClient = client(() => ({ out_result: "submitted", out_reason: "auto" }));
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(rpcClient.rpc).toHaveBeenCalledWith("submit_due_attempt", { p_attempt_id: "attempt-1" });
    expect(logs.error[0]).toEqual({
      event: "scheduler_scan_failed",
      context: { result: "scheduled", error_code: "PGRST000" },
    });
  });

  it("never writes the service-role key or database error text to log output", async () => {
    const secret = "synthetic-service-role-secret";
    const databaseText = "raw database error with internal detail";
    const scans = source({
      listScheduledExams: vi.fn().mockRejectedValue(new Error(`${secret}: ${databaseText}`)),
    });
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runSchedulerTick({
      source: scans,
      rpcClient: client(() => ({ out_result: "not_due" })),
      logger: schedulerLogger,
      now,
    });

    const serialized = output.mock.calls.flat().join(" ");
    expect(serialized).toContain("worker_error");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(databaseText);
    output.mockRestore();
  });

  it("uses the documented 27-call profile for 23 due attempts in one exam", async () => {
    const attempts = Array.from({ length: 23 }, (_, index) => ({
      id: `attempt-${index + 1}`,
      exam_id: "exam-23",
      status: "in_progress" as const,
      extra_minutes: 0,
    }));
    const scans = source({
      listDueAttempts: vi.fn().mockResolvedValue(attempts),
      listLifecycleExams: vi.fn().mockResolvedValue([{ id: "exam-23" }]),
    });
    const rpcClient = client((name) => name === "submit_due_attempt"
      ? { out_result: "submitted", out_reason: "auto" }
      : { out_result: "ended", out_exam_status: "ended", out_finalized_attempts: 0 });
    const logs = memoryLogger();

    await runSchedulerTick({ source: scans, rpcClient, logger: logs.logger, now });

    expect(scans.listScheduledExams).toHaveBeenCalledOnce();
    expect(scans.listDueAttempts).toHaveBeenCalledOnce();
    expect(scans.listLifecycleExams).toHaveBeenCalledOnce();
    expect(rpcClient.rpc).toHaveBeenCalledTimes(24);
    expect((rpcClient.rpc as ReturnType<typeof vi.fn>).mock.calls.filter(([name]) => name === "submit_due_attempt")).toHaveLength(23);
    expect(rpcClient.rpc).toHaveBeenLastCalledWith("finalize_exam_if_closed", { p_exam_id: "exam-23" });
  });
});
