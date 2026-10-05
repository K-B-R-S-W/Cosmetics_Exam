import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkerLanes } from "./index";

afterEach(() => vi.useRealTimers());

describe("worker lanes", () => {
  it("runs lifecycle while a proctoring pass is still hanging", async () => {
    vi.useFakeTimers();
    const lifecycle = vi.fn().mockResolvedValue(undefined);
    const proctoring = vi.fn(() => new Promise<void>(() => undefined));
    const stop = startWorkerLanes(lifecycle, proctoring);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(proctoring).toHaveBeenCalledTimes(1);
    expect(lifecycle).toHaveBeenCalledTimes(3);
    stop();
  });
});
