import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_GRADING_TUNING } from "./config";
import type { GradingRepository } from "./grader";
import { startGradingLane } from "./grading-lane";
import { runGradingTick } from "./runner";
import { SlotManager } from "./slots";

afterEach(() => vi.useRealTimers());
it("uses two seconds while active and never overlaps", async () => {
  vi.useFakeTimers();
  const tick = vi.fn().mockResolvedValue({ active: true });
  const lane = startGradingLane(tick); await vi.runOnlyPendingTimersAsync();
  expect(tick).toHaveBeenCalledTimes(2); lane.stop();
});

it("logs a safe error code at most once per minute for the same failure", async () => {
  vi.useFakeTimers();
  let now = 0;
  const onError = vi.fn();
  const tick = vi.fn().mockRejectedValue(new Error("database error with secret row text"));
  const lane = startGradingLane(tick, { onError, now: () => now });
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenLastCalledWith("grading_tick_failed");
  now = 30_000;
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledOnce();
  now = 60_000;
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledTimes(2);
  lane.stop();
});

it("preserves the known safe database error code", async () => {
  vi.useFakeTimers();
  const onError = vi.fn();
  const lane = startGradingLane(vi.fn().mockRejectedValue(new Error("database_error")), { onError });
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledWith("database_error");
  lane.stop();
});

it("rate-limits a safe lane error when stuck-job reset fails", async () => {
  vi.useFakeTimers();
  let now = 0;
  const onError = vi.fn();
  const resetStuck = vi.fn().mockRejectedValue(new Error("database_error"));
  const repository = { resetStuck } as unknown as GradingRepository;
  const config = { ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash" as const, keys: [], reserve: 0 };
  const lane = startGradingLane(
    () => runGradingTick({ repository, config, slots: new SlotManager([], 0, 0) }),
    { onError, now: () => now },
  );
  await lane.tickNow();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenLastCalledWith("database_error");
  now = 30_000;
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledOnce();
  now = 60_000;
  await vi.runOnlyPendingTimersAsync();
  expect(onError).toHaveBeenCalledTimes(2);
  expect(resetStuck).toHaveBeenCalledTimes(3);
  lane.stop();
});
