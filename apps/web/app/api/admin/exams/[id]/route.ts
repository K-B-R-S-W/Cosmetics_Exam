import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { loadExamDeleteCounts, loadExamStoragePaths, removeExamStorage } from "@/lib/exam-delete";
import { EXAM_COLUMNS, examNotFound, toExamItem } from "@/lib/exam-server";
import {
  examIdSchema,
  schedulingMissing,
  updateExamSchema,
  type ExamItem,
} from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { logger } from "@/lib/logger";
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
    if (body.status === "scheduled" && current.status !== "scheduled") {
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
    const scheduledStartChanged = body.scheduled_start_at !== undefined && (
      body.scheduled_start_at === null || current.scheduled_start_at === null
        ? body.scheduled_start_at !== current.scheduled_start_at
        : new Date(body.scheduled_start_at).getTime() !== new Date(current.scheduled_start_at).getTime()
    );
    if (
      current.status === "scheduled" &&
      body.status !== "draft" &&
      scheduledStartChanged &&
      (
        body.scheduled_start_at === null ||
        new Date(body.scheduled_start_at!).getTime() < Date.now() + 60_000
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
    if (current.status === "live") {
      throw new ApiError("exam_not_deletable", 409, "A live exam cannot be deleted.");
    }
    if (current.status === "ended") {
      throw new ApiError("exam_not_deletable", 409, "This exam is still finalizing. Try again in a minute.");
    }
    if (current.status === "finalized" && admin.role !== "super_admin") {
      throw new ApiError("forbidden", 403, "Only a super admin can delete a finalized exam.");
    }

    const [counts, storagePaths] = await Promise.all([
      loadExamDeleteCounts(client, id),
      loadExamStoragePaths(client, id),
    ]);
    const { data: activeRuns, error: guardError } = await client
      .from("grading_runs")
      .select("id")
      .eq("exam_id", id)
      .in("status", ["running", "paused"])
      .limit(1);
    if (guardError) throw databaseUnavailable();
    if ((activeRuns?.length ?? 0) > 0) {
      throw new ApiError("exam_not_deletable", 409, "Wait for grading to finish before deleting this exam.");
    }
    const allowedStatuses = admin.role === "super_admin"
      ? ["draft", "scheduled", "finalized"]
      : ["draft", "scheduled"];
    const { data, error } = await client
      .from("exams")
      .delete()
      .eq("id", id)
      .in("status", allowedStatuses)
      .select("id")
      .maybeSingle();
    if (error) throw databaseUnavailable();
    if (!data) throw new ApiError("exam_not_deletable", 409, "The exam changed and was not deleted.");

    const warnings: string[] = [];
    const storageFailures = await removeExamStorage(client, storagePaths);
    if (storageFailures > 0) {
      warnings.push(`exam deleted, ${storageFailures} files could not be removed`);
      logger.warn("exam_delete_storage_incomplete", {
        actorId: admin.id,
        failureCount: storageFailures,
      });
    }
    try {
      await recordAdminAction(client, admin, "exam_delete", id, {
        title: current.title,
        status: current.status,
        ...counts,
      });
    } catch {
      warnings.push("Exam deleted, but its audit record could not be written. Contact support.");
      logger.warn("exam_delete_audit_failed", { actorId: admin.id, errorCode: "audit_write_failed" });
    }
    return jsonResponse({ deleted: true, storage_failed: storageFailures, warnings });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
