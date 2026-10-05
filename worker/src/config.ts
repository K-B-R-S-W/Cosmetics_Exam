export const SCHEDULER_INTERVAL_MS = 10_000;
export const PROCTORING_INTERVAL_MS = 30_000;
export const SCHEDULER_EARLY_WINDOW_MS = 60_000;
export const HEALTH_HEARTBEAT_INTERVAL_MS = 30_000;
export const HEALTH_STALE_AFTER_MS = 60_000;
export const HEALTH_GUARD_POLL_INTERVAL_MS = 5_000;
export const HEALTH_GUARD_TAKEOVER_AFTER_MS = 65_000;

export type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required worker environment variable: ${name}`);
  }
  return value;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const supabaseUrl = required(environment, "SUPABASE_URL");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");

  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL or localhost URL");
  }

  return { supabaseUrl, serviceRoleKey };
}
