import { z } from "zod";

import { apiErrorResponse, jsonResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import type { ViolationEvent } from "@/lib/violation-events";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/live/[attemptId]/events";
const EVENT_COLUMNS = "id,type,occurred_at,duration_ms,counts,merged_types,meta,snapshot_path";

export async function GET(_request: Request, context: { params: Promise<{ attemptId: string }> }): Promise<Response> {
  try {
    await requireAdmin();
    const attemptId = z.string().uuid().parse((await context.params).attemptId);
    const client = createServiceRoleClient();
    const { data, error } = await client.from("violation_events").select(EVENT_COLUMNS).eq("attempt_id", attemptId).order("occurred_at", { ascending: false });
    if (error) throw new Error("live_events_load_failed");
    const rows = (data ?? []) as Array<Omit<ViolationEvent, "snapshot_url"> & { snapshot_path: string | null }>;
    const paths = rows.flatMap((row) => row.snapshot_path ? [row.snapshot_path] : []);
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data: urls } = await client.storage.from("snapshots").createSignedUrls(paths, 300);
      for (const item of urls ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    }
    return jsonResponse({ events: rows.map(({ snapshot_path, ...row }) => ({ ...row, snapshot_url: snapshot_path ? signed.get(snapshot_path) ?? null : null })) });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
