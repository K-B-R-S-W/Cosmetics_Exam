import { z } from "zod";

import { apiErrorResponse, jsonResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import {
  databaseUnavailable,
  notFound,
  recordAdminAction,
} from "@/lib/candidate-server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/candidates/[id]/unlock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const parsedId = z.uuid().safeParse((await context.params).id);
    if (!parsedId.success) throw notFound();

    const client = createServiceRoleClient();
    const { data: candidate, error: candidateError } = await client
      .from("candidates")
      .select("id, mer_code")
      .eq("id", parsedId.data)
      .maybeSingle();

    if (candidateError) throw databaseUnavailable();
    if (!candidate) throw notFound();

    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: deleted, error: deleteError } = await client
      .from("login_attempts")
      .delete()
      .eq("mer_code", candidate.mer_code)
      .eq("success", false)
      .gte("attempted_at", cutoff)
      .select("id");

    if (deleteError) throw databaseUnavailable();

    const cleared = deleted?.length ?? 0;
    await recordAdminAction(
      client,
      admin,
      "candidate_unlock",
      candidate.id,
      { cleared },
    );

    return jsonResponse({ cleared });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
