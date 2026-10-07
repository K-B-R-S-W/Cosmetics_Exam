import { apiErrorResponse, jsonResponse } from "@/lib/api";
import { workerHealth, type HealthAlert, type KeyHealth } from "@/lib/admin-health";
import { requireSuperAdmin } from "@/lib/auth";
import { checkLiveKitHealth } from "@/lib/livekit-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ROUTE = "/api/admin/health";

export async function GET(): Promise<Response> {
  try {
    await requireSuperAdmin();
    const client = createServiceRoleClient();
    const supabaseStarted = performance.now();
    const workerRequest = client.from("system_health").select("component,status,last_heartbeat_at").eq("component", "worker").maybeSingle();
    const keysRequest = client.from("api_key_state").select("label,status,cooldown_until,last_error,updated_at").order("label", { ascending: true });
    const alertsRequest = client.from("alerts").select("id,type,severity,message,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false });
    const [workerResult, keysResult, alertsResult, livekit] = await Promise.all([workerRequest, keysRequest, alertsRequest, checkLiveKitHealth()]);
    const supabaseLatency = Math.round(performance.now() - supabaseStarted);
    const supabaseOk = !workerResult.error && !keysResult.error && !alertsResult.error;
    const worker = workerHealth(workerResult.error ? null : workerResult.data);
    const body = {
      checked_at: new Date().toISOString(),
      components: { supabase: { ok: supabaseOk, latency_ms: supabaseLatency }, livekit, worker },
      keys: (keysResult.error ? [] : keysResult.data ?? []) as KeyHealth[],
      alerts: (alertsResult.error ? [] : alertsResult.data ?? []) as HealthAlert[],
    };
    return jsonResponse(body, { status: supabaseOk && worker.ok && livekit.ok ? 200 : 503 });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
