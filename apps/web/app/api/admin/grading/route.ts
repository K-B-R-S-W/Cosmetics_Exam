import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { loadGradingProgress } from "@/lib/grading/admin-data";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/grading";
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(); const parsed = z.uuid().safeParse(new URL(request.url).searchParams.get("exam_id"));
    if (!parsed.success) throw new ApiError("validation_failed", 400, "Provide a valid exam_id.");
    return jsonResponse(await loadGradingProgress(createServiceRoleClient(), parsed.data));
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
