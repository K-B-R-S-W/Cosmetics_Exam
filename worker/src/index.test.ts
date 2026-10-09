import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerHealthStore } from "./health";
import { createShutdownHandler, startWorkerLanes } from "./index";
import { startSnapshotPurgeLane } from "./snapshot-purge";

afterEach(() => vi.useRealTimers());

describe("worker lanes", () => {
  it("does not let a hanging health pass block lifecycle or proctoring", async () => {
    vi.useFakeTimers();
    const lifecycle = vi.fn().mockResolvedValue(undefined);
    const proctoring = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn(() => new Promise<void>(() => undefined));
    const lanes = startWorkerLanes(lifecycle, proctoring, heartbeat, { runHeartbeatImmediately: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(proctoring).toHaveBeenCalledTimes(3);
    expect(lifecycle).toHaveBeenCalledTimes(7);
    lanes.stop();
  });

  it("does not let hanging lifecycle or proctoring passes block health", async () => {
    vi.useFakeTimers();
    const lifecycle = vi.fn(() => new Promise<void>(() => undefined));
    const proctoring = vi.fn(() => new Promise<void>(() => undefined));
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const lanes = startWorkerLanes(lifecycle, proctoring, heartbeat);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle).toHaveBeenCalledTimes(1);
    expect(proctoring).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    lanes.stop();
  });

  it("does not let a hanging snapshot purge block the existing worker lanes", async () => {
    vi.useFakeTimers();
    const lifecycle = vi.fn().mockResolvedValue(undefined);
    const proctoring = vi.fn().mockResolvedValue(undefined);
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    const purge = startSnapshotPurgeLane(() => new Promise<"continue">(() => undefined));
    const lanes = startWorkerLanes(lifecycle, proctoring, heartbeat);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(lifecycle).toHaveBeenCalledTimes(7);
    expect(proctoring).toHaveBeenCalledTimes(3);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    purge.stop();
    lanes.stop();
  });
});

describe("worker shutdown", () => {
  it("waits for an in-flight heartbeat, writes down conditionally, then exits zero once", async () => {
    let releaseHeartbeat!: () => void;
    const heartbeatDone = new Promise<void>((resolve) => { releaseHeartbeat = resolve; });
    const order: string[] = [];
    const store = {
      markDown: vi.fn(async () => { order.push("down"); return true; }),
    } as unknown as WorkerHealthStore;
    const lanes = {
      stop: vi.fn(() => order.push("stop")),
      waitForHeartbeat: vi.fn(async () => { await heartbeatDone; order.push("heartbeat_done"); }),
    };
    const exit = vi.fn((code: number) => order.push(`exit:${code}`));
    const stop = vi.fn();
    const shutdown = createShutdownHandler({
      instance: "instance-a",
      store,
      getLanes: () => lanes,
      ownsRow: () => true,
      setStopping: stop,
      exit,
    });

    const first = shutdown();
    const second = shutdown();
    expect(first).toBe(second);
    expect(order).toEqual(["stop"]);
    releaseHeartbeat();
    await first;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(store.markDown).toHaveBeenCalledWith("instance-a");
    expect(order).toEqual(["stop", "heartbeat_done", "down", "exit:0"]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("does not mark another worker down when stopped during guard polling", async () => {
    const store = { markDown: vi.fn() } as unknown as WorkerHealthStore;
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      instance: "instance-a",
      store,
      getLanes: () => null,
      ownsRow: () => false,
      setStopping: vi.fn(),
      exit,
    });
    await shutdown();
    expect(store.markDown).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("cannot write ok after down when SIGTERM arrives during a heartbeat", async () => {
    const writes: string[] = [];
    let release!: () => void;
    const heartbeatDone = new Promise<void>((resolve) => { release = resolve; });
    const lanes = {
      stop: vi.fn(),
      waitForHeartbeat: vi.fn(async () => heartbeatDone),
    };
    const store = {
      markDown: vi.fn(async () => { writes.push("down"); return true; }),
    } as unknown as WorkerHealthStore;
    const shutdown = createShutdownHandler({
      instance: "instance-a",
      store,
      getLanes: () => lanes,
      ownsRow: () => true,
      setStopping: vi.fn(),
      exit: vi.fn(),
    });
    const stopping = shutdown();
    writes.push("heartbeat_ok");
    release();
    await stopping;
    expect(writes).toEqual(["heartbeat_ok", "down"]);
  });
});
