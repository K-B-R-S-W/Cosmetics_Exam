import { describe, expect, it, vi } from "vitest";

import {
  acquireWorkerOwnership,
  createHeartbeatRunner,
  createWorkerHealthStore,
  parseHealthDetail,
  serializeHealthDetail,
  type WorkerHealthRow,
  type WorkerHealthStore,
} from "./health";
import type { SchedulerLogger } from "./logger";

const now = new Date("2030-01-01T00:10:00.000Z");
const identity = { instance: "instance-a", version: "0.1.0", startedAt: "2030-01-01T00:00:00.000Z" };
const activity = { lastLifecycleTickAt: null, lastProctoringTickAt: null };

function row(overrides: Partial<WorkerHealthRow> = {}): WorkerHealthRow {
  return {
    component: "worker",
    status: "ok",
    last_heartbeat_at: now.toISOString(),
    detail: JSON.stringify({ instance: "instance-b", beat: 1 }),
    ...overrides,
  };
}

function logger() {
  return {
    info: vi.fn<SchedulerLogger["info"]>(),
    error: vi.fn<SchedulerLogger["error"]>(),
  };
}

function store(overrides: Partial<WorkerHealthStore> = {}): WorkerHealthStore {
  return {
    read: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(true),
    heartbeat: vi.fn().mockResolvedValue(true),
    markDown: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("startup ownership guard", () => {
  it.each([
    ["missing", null],
    ["down", row({ status: "down" })],
    ["stale", row({ last_heartbeat_at: new Date(now.getTime() - 60_000).toISOString() })],
  ])("claims a %s worker row", async (_label, observed) => {
    const health = store({ read: vi.fn().mockResolvedValue(observed) });
    await expect(acquireWorkerOwnership({
      store: health, identity, activity, logger: logger(), now: () => now,
    })).resolves.toBe("owned");
    expect(health.claim).toHaveBeenCalledTimes(1);
  });

  it("exits three when a fresh other heartbeat advances during polling", async () => {
    const first = row();
    const advanced = row({ last_heartbeat_at: new Date(now.getTime() + 1_000).toISOString(), detail: JSON.stringify({ instance: "instance-b", beat: 2 }) });
    const health = store({ read: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(advanced) });
    const log = logger();
    await expect(acquireWorkerOwnership({
      store: health, identity, activity, logger: log, now: () => now, sleep: vi.fn().mockResolvedValue(undefined),
    })).resolves.toBe("guard_exit");
    expect(log.error).toHaveBeenCalledWith("guard_exit", { error_code: "other_worker_alive" });
    expect(health.claim).not.toHaveBeenCalled();
  });

  it("takes over when a fresh heartbeat never advances for 65 seconds", async () => {
    const frozen = row();
    const health = store({ read: vi.fn().mockResolvedValue(frozen) });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(acquireWorkerOwnership({
      store: health, identity, activity, logger: logger(), now: () => now, sleep,
    })).resolves.toBe("owned");
    expect(sleep).toHaveBeenCalledTimes(13);
    expect(health.claim).toHaveBeenCalledWith(frozen, expect.objectContaining({ status: "ok" }));
  });

  it("allows exactly one simultaneous missing-row claim and sends the loser through polling", async () => {
    let current: WorkerHealthRow | null = null;
    const shared: WorkerHealthStore = {
      read: vi.fn(async () => current),
      claim: vi.fn(async (observed, write) => {
        if (observed !== current) return false;
        if (current === null) {
          current = { component: "worker", ...write };
          return true;
        }
        return false;
      }),
      heartbeat: vi.fn(),
      markDown: vi.fn(),
    };
    let poll = 0;
    const sleep = vi.fn(async () => {
      poll += 1;
      if (poll === 1 && current) {
        current = { ...current, last_heartbeat_at: new Date(now.getTime() + 1_000).toISOString(), detail: JSON.stringify({ instance: "instance-a", beat: 2 }) };
      }
    });
    const other = { ...identity, instance: "instance-b" };
    const [a, b] = await Promise.all([
      acquireWorkerOwnership({ store: shared, identity, activity, logger: logger(), now: () => now, sleep }),
      acquireWorkerOwnership({ store: shared, identity: other, activity, logger: logger(), now: () => now, sleep }),
    ]);
    expect([a, b].sort()).toEqual(["guard_exit", "owned"]);
    expect(shared.claim).toHaveBeenCalledTimes(2);
  });

  it("handles a zero-row conditional claim as a lost race", async () => {
    const fresh = row();
    const advanced = row({ last_heartbeat_at: new Date(now.getTime() + 1_000).toISOString() });
    const health = store({
      read: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(fresh).mockResolvedValueOnce(advanced),
      claim: vi.fn().mockResolvedValue(false),
    });
    await expect(acquireWorkerOwnership({
      store: health, identity, activity, logger: logger(), now: () => now, sleep: vi.fn().mockResolvedValue(undefined),
    })).resolves.toBe("guard_exit");
  });

  it("logs negative clock skew without exposing row contents", async () => {
    const future = row({ last_heartbeat_at: new Date(now.getTime() + 10_000).toISOString() });
    const advanced = row({ last_heartbeat_at: new Date(now.getTime() + 11_000).toISOString() });
    const health = store({ read: vi.fn().mockResolvedValueOnce(future).mockResolvedValueOnce(advanced) });
    const log = logger();
    await acquireWorkerOwnership({ store: health, identity, activity, logger: log, now: () => now, sleep: vi.fn().mockResolvedValue(undefined) });
    expect(log.error).toHaveBeenCalledWith("guard_clock_skew", { error_code: "worker_clock_behind_database" });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(future.detail);
  });
});

describe("conditional heartbeat", () => {
  it("re-reads a zero-row write and exits for a fresh other instance", async () => {
    const own = row({ detail: serializeHealthDetail(identity, activity, 1) });
    const other = row();
    const health = store({ read: vi.fn().mockResolvedValueOnce(own).mockResolvedValueOnce(other), heartbeat: vi.fn().mockResolvedValue(false) });
    const onGuardExit = vi.fn();
    const run = createHeartbeatRunner({ store: health, identity, activity, logger: logger(), now: () => now, isStopping: () => false, onGuardExit });
    await expect(run()).resolves.toBe("guard_exit");
    expect(onGuardExit).toHaveBeenCalledTimes(1);
  });

  it("reclaims a stale other row after a zero-row write", async () => {
    const own = row({ detail: serializeHealthDetail(identity, activity, 1) });
    const stale = row({ last_heartbeat_at: new Date(now.getTime() - 60_000).toISOString() });
    const health = store({ read: vi.fn().mockResolvedValueOnce(own).mockResolvedValueOnce(stale), heartbeat: vi.fn().mockResolvedValue(false) });
    const run = createHeartbeatRunner({ store: health, identity, activity, logger: logger(), now: () => now, isStopping: () => false, onGuardExit: vi.fn() });
    await expect(run()).resolves.toBe("ok");
    expect(health.claim).toHaveBeenCalledWith(stale, expect.objectContaining({ status: "ok" }));
  });

  it("logs heartbeat failures once and recovery once without secrets or row data", async () => {
    const own = row({ detail: serializeHealthDetail(identity, activity, 1) });
    const read = vi.fn().mockRejectedValueOnce(Object.assign(new Error("secret-service-key database detail"), { code: "PGRST000" })).mockRejectedValueOnce(Object.assign(new Error("different text"), { code: "PGRST000" })).mockResolvedValue(own);
    const health = store({ read });
    const log = logger();
    const run = createHeartbeatRunner({ store: health, identity, activity, logger: log, now: () => now, isStopping: () => false, onGuardExit: vi.fn() });
    await run();
    await run();
    await run();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("worker_heartbeat_recovered", { result: "recovered" });
    const output = JSON.stringify([...log.error.mock.calls, ...log.info.mock.calls]);
    expect(output).not.toContain("secret-service-key");
    expect(output).not.toContain(own.detail);
  });

  it("does not write after stopping", async () => {
    const health = store();
    const run = createHeartbeatRunner({ store: health, identity, activity, logger: logger(), now: () => now, isStopping: () => true, onGuardExit: vi.fn() });
    await run();
    expect(health.read).not.toHaveBeenCalled();
    expect(health.heartbeat).not.toHaveBeenCalled();
  });
});

describe("health detail and PostgREST adapter", () => {
  it("uses only the approved detail keys", () => {
    const detail = JSON.parse(serializeHealthDetail(identity, activity, 7));
    expect(detail).toEqual({
      instance: "instance-a", version: "0.1.0", started_at: identity.startedAt,
      last_lifecycle_tick_at: null, last_proctoring_tick_at: null, beat: 7,
    });
    expect(parseHealthDetail(JSON.stringify(detail))?.instance).toBe("instance-a");
    expect(JSON.stringify(detail)).not.toContain("secret");
  });

  it("serializes every grading slot limit without changing it", () => {
    const gradingActivity = {
      ...activity,
      grading: {
        queue: { pending: 0, running: 0, failed: 0 },
        slots: ["key1", "key2", "key3"].map((key) => ({ key, model: "gemini-3.7-flash", used: 0, limit: 100, cooldown_until: null, disabled: false })),
      },
    };
    const detail = JSON.parse(serializeHealthDetail(identity, gradingActivity, 8));
    expect(detail.slots.map((slot: { key: string; limit: number }) => [slot.key, slot.limit])).toEqual([["key1", 100], ["key2", 100], ["key3", 100]]);
  });

  it("treats insert unique violation 23505 as a lost race", async () => {
    const client = {
      from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: { code: "23505" } }) })),
    };
    const adapter = createWorkerHealthStore(client as never);
    await expect(adapter.claim(null, { status: "ok", last_heartbeat_at: now.toISOString(), detail: "{}" })).resolves.toBe(false);
  });

  it("treats an update returning no row as a lost race and matches exact text", async () => {
    const calls: Array<[string, unknown]> = [];
    const terminal = { maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const query = {
      eq: vi.fn((column: string, value: unknown) => { calls.push([`eq:${column}`, value]); return query; }),
      is: vi.fn((column: string, value: unknown) => { calls.push([`is:${column}`, value]); return query; }),
      select: vi.fn(() => terminal),
    };
    const client = { from: vi.fn(() => ({ update: vi.fn(() => query) })) };
    const adapter = createWorkerHealthStore(client as never);
    const observed = row({ status: "degraded", last_heartbeat_at: null, detail: "exact detail text" });
    await expect(adapter.heartbeat(observed, { status: "ok", last_heartbeat_at: now.toISOString(), detail: "new" })).resolves.toBe(false);
    expect(calls).toEqual([
      ["eq:component", "worker"], ["eq:status", "degraded"], ["eq:detail", "exact detail text"], ["is:last_heartbeat_at", null],
    ]);
    expect(query.select).toHaveBeenCalledWith("component");
  });
});
