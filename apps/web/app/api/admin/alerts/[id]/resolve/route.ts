import { z } from "zod";
import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireSuperAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/alerts/[id]/resolve";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireSuperAdmin();
    const id = z.uuid().parse((await context.params).id);
    const client = createServiceRoleClient();
    const { data, error } = await client.from("alerts").update({ resolved_at: new Date().toISOString() }).eq("id", id).is("resolved_at", null).select("id,resolved_at").maybeSingle();
    if (error) throw new Error("alert_resolve_failed");
    if (data) await recordAdminAction(client, admin, "alert_resolve", id, { resolved: true });
    if (!data) {
      const { data: existing, error: lookupError } = await client.from("alerts").select("id,resolved_at").eq("id", id).maybeSingle();
      if (lookupError) throw new Error("alert_lookup_failed");
      if (!existing) throw new ApiError("not_found", 404, "Alert not found.");
      return jsonResponse({ resolved: true, already_resolved: true });
    }
    return jsonResponse({ resolved: true, already_resolved: false });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
