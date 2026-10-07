export const WORKER_STALE_MS = 90_000;

export type HealthAlert = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  created_at: string;
  resolved_at: string | null;
};

export type KeyHealth = {
  label: string;
  status: "active" | "cooldown" | "disabled";
  cooldown_until: string | null;
  last_error: string | null;
  updated_at: string;
};

export type AdminHealthBody = {
  checked_at: string;
  components: {
    supabase: { ok: boolean; latency_ms: number };
    livekit: { ok: boolean; latency_ms: number; room_count: number | null };
    worker: { ok: boolean; status: string; last_heartbeat_at: string | null; age_ms: number | null };
  };
  keys: KeyHealth[];
  alerts: HealthAlert[];
};

export function workerHealth(row: { status: string; last_heartbeat_at: string | null } | null, now = Date.now()) {
  const parsed = row?.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : Number.NaN;
  const age = Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
  return {
    ok: row?.status === "ok" && age !== null && age <= WORKER_STALE_MS,
    status: row?.status ?? "down",
    last_heartbeat_at: row?.last_heartbeat_at ?? null,
    age_ms: age,
  };
}
