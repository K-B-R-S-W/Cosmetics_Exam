import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { workerHealth } from "@/lib/admin-health";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(): Promise<NextResponse> {
  const startedAt = performance.now();

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("system_health")
      .select("status,last_heartbeat_at")
      .eq("component", "worker")
      .maybeSingle();

    if (error) {
      throw new Error("supabase_health_query_failed");
    }

    const worker = workerHealth(data);
    return NextResponse.json({ ok: worker.ok, time: new Date().toISOString() }, { status: worker.ok ? 200 : 503, headers: NO_STORE_HEADERS });
  } catch {
    logger.error("health_check_failed", {
      route: "/api/health",
      status: 503,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: "supabase_unavailable",
    });

    return NextResponse.json(
      { ok: false },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
