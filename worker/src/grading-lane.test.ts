import { afterEach, expect, it, vi } from "vitest";
import { startGradingLane } from "./grading-lane";

afterEach(() => vi.useRealTimers());
it("uses two seconds while active and never overlaps", async () => {
  vi.useFakeTimers();
  const tick = vi.fn().mockResolvedValue({ active: true });
  const lane = startGradingLane(tick); await vi.runOnlyPendingTimersAsync();
  expect(tick).toHaveBeenCalledTimes(2); lane.stop();
});
