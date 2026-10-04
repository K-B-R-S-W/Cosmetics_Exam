import { apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { EXAM_COLUMNS, toExamItem } from "@/lib/exam-server";
import { createExamSchema } from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams";
const EXAM_WITH_COUNTS = `${EXAM_COLUMNS}, questions(count), exam_candidates(count)`;

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("exams")
      .select(EXAM_WITH_COUNTS)
      .order("created_at", { ascending: false });

    if (error) throw databaseUnavailable();
    return jsonResponse({ items: (data ?? []).map((row) => toExamItem(row as never)) });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = createExamSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("exams")
      .insert({
        title: body.title,
        instructions: body.instructions ?? null,
        scheduled_start_at: body.scheduled_start_at ?? null,
        duration_min: body.duration_min,
        navigation_mode: body.navigation_mode,
        shuffle: body.shuffle,
        flag_threshold: body.flag_threshold,
        is_practice: body.is_practice,
        created_by: admin.id,
      })
      .select(EXAM_COLUMNS)
      .single();

    if (error || !data) throw databaseUnavailable();
    await recordAdminAction(client, admin, "exam_create", data.id);

    return jsonResponse(
      { exam: toExamItem({ ...data, questions: [], exam_candidates: [] } as never) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
