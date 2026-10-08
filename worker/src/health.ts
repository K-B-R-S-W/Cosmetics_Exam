import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HEALTH_GUARD_POLL_INTERVAL_MS,
  HEALTH_GUARD_TAKEOVER_AFTER_MS,
  HEALTH_STALE_AFTER_MS,
} from "./config";
import type { SchedulerLogger } from "./logger";

export const WORKER_VERSION = "0.1.0";
const CLOCK_SKEW_WARNING_MS = 5_000;
const FAILURE_REMINDER_MS = 5 * 60_000;

export type WorkerHealthRow = {
  component: "worker";
  status: "ok" | "degraded" | "down";
  last_heartbeat_at: string | null;
  detail: string | null;
};

export type WorkerActivity = {
  lastLifecycleTickAt: string | null;
  lastProctoringTickAt: string | null;
  grading?: {
    queue: { pending: number; running: number; failed: number };
    slots: { key: string; model: string; used: number; limit: number; cooldown_until: string | null; disabled: boolean }[];
  };
};

export type WorkerIdentity = {
  instance: string;
  version: string;
  startedAt: string;
};

export type WorkerHealthWrite = Omit<WorkerHealthRow, "component">;

export interface WorkerHealthStore {
  read(): Promise<WorkerHealthRow | null>;
  claim(observed: WorkerHealthRow | null, write: WorkerHealthWrite): Promise<boolean>;
  heartbeat(observed: WorkerHealthRow, write: WorkerHealthWrite): Promise<boolean>;
  markDown(instance: string): Promise<boolean>;
}

export type GuardResult = "owned" | "guard_exit" | "stopped";
export type HeartbeatResult = "ok" | "retry" | "guard_exit";

type HealthDetail = {
  instance: string;
  version?: string;
  started_at?: string;
  last_lifecycle_tick_at?: string | null;
  last_proctoring_tick_at?: string | null;
  beat?: number;
};

type GuardOptions = {
  store: WorkerHealthStore;
  identity: WorkerIdentity;
  activity: WorkerActivity;
  logger: SchedulerLogger;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  isStopping?: () => boolean;
};

type HeartbeatOptions = Omit<GuardOptions, "sleep" | "isStopping"> & {
  isStopping: () => boolean;
  onGuardExit: () => void;
};

function errorCode(error: unknown): string {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "database_error";
}

export function parseHealthDetail(detail: string | null): HealthDetail | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== "object" || !("instance" in parsed)) return null;
    const instance = (parsed as { instance?: unknown }).instance;
    return typeof instance === "string" ? parsed as HealthDetail : null;
  } catch {
    return null;
  }
}

export function serializeHealthDetail(
  identity: WorkerIdentity,
  activity: WorkerActivity,
  beat: number,
): string {
  return JSON.stringify({
    instance: identity.instance,
    version: identity.version,
    started_at: identity.startedAt,
    last_lifecycle_tick_at: activity.lastLifecycleTickAt,
    last_proctoring_tick_at: activity.lastProctoringTickAt,
    ...(activity.grading ?? {}),
    beat,
  });
}

function heartbeatAge(row: WorkerHealthRow, now: Date): number | null {
  if (!row.last_heartbeat_at) return null;
  const timestamp = Date.parse(row.last_heartbeat_at);
  return Number.isFinite(timestamp) ? now.getTime() - timestamp : null;
}

function isClaimable(row: WorkerHealthRow | null, now: Date): boolean {
  if (!row || row.status === "down" || !row.last_heartbeat_at) return true;
  const age = heartbeatAge(row, now);
  return age === null || age >= HEALTH_STALE_AFTER_MS;
}

function writeFor(identity: WorkerIdentity, activity: WorkerActivity, beat: number, now: Date): WorkerHealthWrite {
  return {
    status: "ok",
    last_heartbeat_at: now.toISOString(),
    detail: serializeHealthDetail(identity, activity, beat),
  };
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function acquireWorkerOwnership(options: GuardOptions): Promise<GuardResult> {
  const now = options.now || (() => new Date());
  const sleep = options.sleep || defaultSleep;
  const isStopping = options.isStopping || (() => false);
  let observed = await options.store.read();
  let clockSkewLogged = false;

  while (!isStopping()) {
    const age = observed ? heartbeatAge(observed, now()) : null;
    if (age !== null && age < -CLOCK_SKEW_WARNING_MS && !clockSkewLogged) {
      options.logger.error("guard_clock_skew", { error_code: "worker_clock_behind_database" });
      clockSkewLogged = true;
    } else if (age === null || age >= -CLOCK_SKEW_WARNING_MS) {
      clockSkewLogged = false;
    }

    if (isClaimable(observed, now())) {
      const claimed = await options.store.claim(observed, writeFor(options.identity, options.activity, 1, now()));
      if (claimed) return "owned";
      observed = await options.store.read();
      continue;
    }

    const owner = parseHealthDetail(observed?.detail || null)?.instance;
    if (owner === options.identity.instance) return "owned";

    const initialHeartbeat = observed?.last_heartbeat_at;
    let waited = 0;
    while (waited < HEALTH_GUARD_TAKEOVER_AFTER_MS && !isStopping()) {
      await sleep(HEALTH_GUARD_POLL_INTERVAL_MS);
      waited += HEALTH_GUARD_POLL_INTERVAL_MS;
      if (isStopping()) return "stopped";
      const next = await options.store.read();
      if (!next || next.status === "down") {
        const claimed = await options.store.claim(next, writeFor(options.identity, options.activity, 1, now()));
        if (claimed) return "owned";
        observed = await options.store.read();
        break;
      }
      if (next?.last_heartbeat_at !== initialHeartbeat) {
        options.logger.error("guard_exit", { error_code: "other_worker_alive" });
        return "guard_exit";
      }
      observed = next;
    }
    if (isStopping()) return "stopped";

    const claimed = await options.store.claim(observed, writeFor(options.identity, options.activity, 1, now()));
    if (claimed) return "owned";
    observed = await options.store.read();
  }

  return "stopped";
}

export function createHeartbeatRunner(options: HeartbeatOptions): () => Promise<HeartbeatResult> {
  let beat = 1;
  let failure: { code: string; loggedAt: number } | null = null;

  const logFailure = (code: string, now: Date) => {
    if (!failure || failure.code !== code || now.getTime() - failure.loggedAt >= FAILURE_REMINDER_MS) {
      options.logger.error("worker_heartbeat_failed", { error_code: code });
      failure = { code, loggedAt: now.getTime() };
    }
  };

  const recover = () => {
    if (failure) {
      options.logger.info("worker_heartbeat_recovered", { result: "recovered" });
      failure = null;
    }
  };

  return async () => {
    if (options.isStopping()) return "retry";
    const now = (options.now || (() => new Date()))();
    try {
      let observed = await options.store.read();
      if (options.isStopping()) return "retry";
      const owner = parseHealthDetail(observed?.detail || null)?.instance;
      const age = observed ? heartbeatAge(observed, now) : null;
      if (observed && owner !== options.identity.instance && observed.status !== "down" && age !== null && age < HEALTH_STALE_AFTER_MS) {
        options.logger.error("guard_exit", { error_code: "other_worker_alive" });
        options.onGuardExit();
        return "guard_exit";
      }

      if (!observed || owner !== options.identity.instance || observed.status === "down") {
        const claimed = await options.store.claim(observed, writeFor(options.identity, options.activity, ++beat, now));
        if (claimed) {
          recover();
          return "ok";
        }
        observed = await options.store.read();
        const currentOwner = parseHealthDetail(observed?.detail || null)?.instance;
        const currentAge = observed ? heartbeatAge(observed, now) : null;
        if (observed && currentOwner !== options.identity.instance && observed.status !== "down" && currentAge !== null && currentAge < HEALTH_STALE_AFTER_MS) {
          options.logger.error("guard_exit", { error_code: "other_worker_alive" });
          options.onGuardExit();
          return "guard_exit";
        }
        logFailure("heartbeat_claim_lost", now);
        return "retry";
      }

      const changed = await options.store.heartbeat(observed, writeFor(options.identity, options.activity, ++beat, now));
      if (changed) {
        recover();
        return "ok";
      }

      const current = await options.store.read();
      const currentOwner = parseHealthDetail(current?.detail || null)?.instance;
      const currentAge = current ? heartbeatAge(current, now) : null;
      if (current && currentOwner !== options.identity.instance && current.status !== "down" && currentAge !== null && currentAge < HEALTH_STALE_AFTER_MS) {
        options.logger.error("guard_exit", { error_code: "other_worker_alive" });
        options.onGuardExit();
        return "guard_exit";
      }
      if (current && currentOwner !== options.identity.instance && isClaimable(current, now)) {
        const reclaimed = await options.store.claim(current, writeFor(options.identity, options.activity, ++beat, now));
        if (reclaimed) {
          recover();
          return "ok";
        }
      }
      logFailure("heartbeat_write_lost", now);
      return "retry";
    } catch (error) {
      logFailure(errorCode(error), now);
      return "retry";
    }
  };
}

type QueryResult = { data: WorkerHealthRow | null; error: { code?: string } | null };

export function createWorkerHealthStore(client: SupabaseClient): WorkerHealthStore {
  const read = async (): Promise<WorkerHealthRow | null> => {
    const { data, error } = await client
      .from("system_health")
      .select("component,status,last_heartbeat_at,detail")
      .eq("component", "worker")
      .maybeSingle() as QueryResult;
    if (error) throw Object.assign(new Error("worker_health_read_failed"), { code: error.code });
    return data;
  };

  return {
    read,
    async claim(observed, write) {
      if (!observed) {
        const { error } = await client.from("system_health").insert({ component: "worker", ...write });
        if (error?.code === "23505") return false;
        if (error) throw Object.assign(new Error("worker_health_claim_failed"), { code: error.code });
        return true;
      }
      let query = client.from("system_health").update(write).eq("component", "worker").eq("status", observed.status);
      query = observed.detail === null ? query.is("detail", null) : query.eq("detail", observed.detail);
      if (observed.last_heartbeat_at === null) query = query.is("last_heartbeat_at", null);
      const { data, error } = await query.select("component").maybeSingle();
      if (error) throw Object.assign(new Error("worker_health_claim_failed"), { code: error.code });
      return data !== null;
    },
    async heartbeat(observed, write) {
      let query = client.from("system_health").update(write).eq("component", "worker").eq("status", observed.status);
      query = observed.detail === null ? query.is("detail", null) : query.eq("detail", observed.detail);
      if (observed.last_heartbeat_at === null) query = query.is("last_heartbeat_at", null);
      const { data, error } = await query.select("component").maybeSingle();
      if (error) throw Object.assign(new Error("worker_heartbeat_write_failed"), { code: error.code });
      return data !== null;
    },
    async markDown(instance) {
      const observed = await read();
      if (!observed || parseHealthDetail(observed.detail)?.instance !== instance) return false;
      let query = client.from("system_health").update({ status: "down" }).eq("component", "worker").eq("status", observed.status);
      query = observed.detail === null ? query.is("detail", null) : query.eq("detail", observed.detail);
      if (observed.last_heartbeat_at === null) query = query.is("last_heartbeat_at", null);
      const { data, error } = await query.select("component").maybeSingle();
      if (error) throw Object.assign(new Error("worker_health_shutdown_failed"), { code: error.code });
      return data !== null;
    },
  };
}
