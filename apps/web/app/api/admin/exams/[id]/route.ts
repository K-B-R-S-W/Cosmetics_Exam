import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { EXAM_COLUMNS, examNotFound, toExamItem } from "@/lib/exam-server";
import {
  examIdSchema,
  schedulingMissing,
  updateExamSchema,
  type ExamItem,
} from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]";
const EXAM_WITH_COUNTS = `${EXAM_COLUMNS}, questions(count), exam_candidates(count)`;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function examId(context: RouteContext): Promise<string> {
  const result = examIdSchema.safeParse((await context.params).id);
  if (!result.success) throw examNotFound();
  return result.data;
}

async function loadExam(client: ReturnType<typeof createServiceRoleClient>, id: string): Promise<ExamItem> {
  const { data, error } = await client
    .from("exams")
    .select(EXAM_WITH_COUNTS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseUnavailable();
  if (!data) throw examNotFound();
  return toExamItem(data as never);
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdmin();
    const id = await examId(context);
    const client = createServiceRoleClient();
    const [exam, questionResult] = await Promise.all([
      loadExam(client, id),
      client.from("questions").select("id, answer_keys(question_id)").eq("exam_id", id),
    ]);
    if (questionResult.error) throw databaseUnavailable();
    const missingKeyIds = (questionResult.data ?? [])
      .filter((question) => {
        const key = (question as { answer_keys?: unknown }).answer_keys;
        return key === null || (Array.isArray(key) && key.length === 0);
      })
      .map((question) => question.id);
    const warnings = missingKeyIds.length
      ? [{ code: "missing_answer_key" as const, question_ids: missingKeyIds }]
      : [];
    return jsonResponse({ exam, question_count: exam.question_count, assigned_count: exam.assigned_count, warnings });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await examId(context);
    const body = updateExamSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const current = await loadExam(client, id);

    if (body.status && ["live", "ended", "finalized"].includes(body.status)) {
      throw new ApiError("use_control_route", 400, "Use the exam control route for that status change.");
    }

    const suppliedFields = Object.keys(body);
    const allowed = current.status === "finalized"
      ? new Set(["title"])
      : ["live", "ended"].includes(current.status)
        ? new Set(["title", "flag_threshold"])
        : null;
    const lockedFields = allowed
      ? suppliedFields.filter((field) => !allowed.has(field))
      : [];
    if (lockedFields.length) {
      throw new ApiError(
        "exam_locked",
        409,
        "This exam has started, so those settings can no longer change.",
        { locked_fields: lockedFields },
      );
    }

    const changes: Record<string, unknown> = { ...body };
    if (body.status === "scheduled") {
      const effective = { ...current, ...body } as ExamItem;
      const missing = schedulingMissing(effective);
      if (missing.length) {
        throw new ApiError(
          "not_ready",
          409,
          "The exam is not ready to schedule.",
          { missing },
        );
      }
    }
    if (
      current.status === "scheduled" &&
      body.scheduled_start_at !== undefined &&
      (
        body.scheduled_start_at === null ||
        new Date(body.scheduled_start_at).getTime() < Date.now() + 60_000
      )
    ) {
      throw new ApiError(
        "not_ready",
        409,
        "The exam is not ready to schedule.",
        { missing: ["start_time"] },
      );
    }

    const { data, error } = await client
      .from("exams")
      .update(changes)
      .eq("id", id)
      .eq("status", current.status)
      .select(EXAM_COLUMNS)
      .maybeSingle();
    if (error) throw databaseUnavailable();
    if (!data) {
      throw new ApiError(
        "exam_locked",
        409,
        "The exam changed. Reload and try again.",
      );
    }

    const auditDetail = body.flag_threshold === undefined
      ? null
      : {
          old_flag_threshold: current.flag_threshold,
          new_flag_threshold: body.flag_threshold,
        };
    await recordAdminAction(client, admin, "exam_update", id, auditDetail);

    return jsonResponse({
      exam: toExamItem({
        ...data,
        questions: [{ count: current.question_count }],
        exam_candidates: [{ count: current.assigned_count }],
      } as never),
    });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await examId(context);
    const client = createServiceRoleClient();
    const current = await loadExam(client, id);
    if (current.status !== "draft") {
      throw new ApiError("exam_not_deletable", 409, "Only a draft exam can be deleted.");
    }
    const { data: started, error: guardError } = await client
      .from("attempts")
      .select("id")
      .eq("exam_id", id)
      .neq("status", "not_started")
      .limit(1);
    if (guardError) throw databaseUnavailable();
    if ((started?.length ?? 0) > 0) {
      throw new ApiError("exam_not_deletable", 409, "This exam has started attempts and cannot be deleted.");
    }
    const { data, error } = await client
      .from("exams")
      .delete()
      .eq("id", id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) throw databaseUnavailable();
    if (!data) throw new ApiError("exam_not_deletable", 409, "The exam changed and was not deleted.");
    await recordAdminAction(client, admin, "exam_delete", id);
    return jsonResponse({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
