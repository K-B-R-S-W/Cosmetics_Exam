import { afterEach, expect, it, vi } from "vitest";
import { startGradingLane } from "./grading-lane";

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
