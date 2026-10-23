import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { databaseUnavailable } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { loadExamDeleteCounts } from "@/lib/exam-delete";
import { examIdSchema } from "@/lib/exams";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/delete-preview";
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdmin();
    const parsed = examIdSchema.safeParse((await context.params).id);
    if (!parsed.success) throw new ApiError("not_found", 404, "Exam not found.");
    const client = createServiceRoleClient();
    const { data: exam, error } = await client.from("exams").select("id,title,status").eq("id", parsed.data).maybeSingle();
    if (error) throw databaseUnavailable();
    if (!exam) throw new ApiError("not_found", 404, "Exam not found.");
    const counts = await loadExamDeleteCounts(client, parsed.data);
    return jsonResponse({ exam, counts });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
