import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import {
  databaseUnavailable,
  quotedPostgrestPattern,
  recordAdminAction,
} from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { examNotFound } from "@/lib/exam-server";
import {
  AVAILABLE_CANDIDATE_SCAN_LIMIT,
  examCandidateMutationSchema,
  examCandidatesQuerySchema,
  examIdSchema,
} from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/candidates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function examId(context: RouteContext): Promise<string> {
  const result = examIdSchema.safeParse((await context.params).id);
  if (!result.success) throw examNotFound();
  return result.data;
}

async function loadExam(client: ReturnType<typeof createServiceRoleClient>, id: string) {
  const { data, error } = await client
    .from("exams")
    .select("id, title, status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseUnavailable();
  if (!data) throw examNotFound();
  return data;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    await requireAdmin();
    const id = await examId(context);
    const query = examCandidatesQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const client = createServiceRoleClient();
    const examPromise = loadExam(client, id);

    if (query.view === "assigned") {
      const [exam, attemptsResult] = await Promise.all([
        examPromise,
        client
          .from("attempts")
          .select("id, status, candidate_id, candidates(id, mer_code, full_name, outlet)")
          .eq("exam_id", id)
          .order("candidate_id", { ascending: true }),
      ]);
      if (attemptsResult.error) throw databaseUnavailable();
      const items = (attemptsResult.data ?? []).map((row) => {
        const candidateValue = (row as { candidates: unknown }).candidates;
        const candidate = (Array.isArray(candidateValue) ? candidateValue[0] : candidateValue) as {
          mer_code: string;
          full_name: string;
          outlet: string | null;
        };
        return {
          candidate_id: row.candidate_id,
          mer_code: candidate.mer_code,
          full_name: candidate.full_name,
          outlet: candidate.outlet,
          attempt_id: row.id,
          attempt_status: row.status,
        };
      }).sort((a, b) => a.mer_code.localeCompare(b.mer_code));
      return jsonResponse({ exam, items });
    }

    const assignments = client
      .from("exam_candidates")
      .select("candidate_id")
      .eq("exam_id", id);
    let candidates = client
      .from("candidates")
      .select("id, mer_code, full_name, outlet")
      .eq("active", true)
      .order("mer_code", { ascending: true })
      .range(0, AVAILABLE_CANDIDATE_SCAN_LIMIT - 1);
    if (query.q) {
      const pattern = quotedPostgrestPattern(query.q);
      candidates = candidates.or(
        `mer_code.ilike.${pattern},full_name.ilike.${pattern},outlet.ilike.${pattern}`,
      );
    }
    const [exam, assignedResult, candidateResult] = await Promise.all([
      examPromise,
      assignments,
      candidates,
    ]);
    if (assignedResult.error || candidateResult.error) throw databaseUnavailable();
    const assigned = new Set((assignedResult.data ?? []).map((row) => row.candidate_id));
    const available = (candidateResult.data ?? [])
      .filter((candidate) => !assigned.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        mer_code: candidate.mer_code,
        full_name: candidate.full_name,
        outlet: candidate.outlet,
      }));
    const start = (query.page - 1) * query.page_size;
    return jsonResponse({
      exam,
      items: available.slice(start, start + query.page_size),
      total: available.length,
      scan_limit: AVAILABLE_CANDIDATE_SCAN_LIMIT,
      scanned_count: candidateResult.data?.length ?? 0,
    });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await examId(context);
    const body = examCandidateMutationSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const exam = await loadExam(client, id);
    if (["ended", "finalized"].includes(exam.status)) {
      throw new ApiError("exam_locked", 409, "The exam has ended, so candidates can no longer be added or removed.");
    }

    const { data: candidates, error: candidateError } = await client
      .from("candidates")
      .select("id, active")
      .in("id", body.candidate_ids);
    if (candidateError) throw databaseUnavailable();
    const valid = new Set((candidates ?? []).filter((candidate) => candidate.active).map((candidate) => candidate.id));
    const invalidCount = body.candidate_ids.filter((candidateId) => !valid.has(candidateId)).length;
    if (invalidCount) {
      throw new ApiError(
        "validation_failed",
        400,
        `${invalidCount} selected candidate${invalidCount === 1 ? " is" : "s are"} unavailable or inactive. Refresh and try again.`,
        { invalid_count: invalidCount },
      );
    }

    const { data: existing, error: existingError } = await client
      .from("exam_candidates")
      .select("candidate_id")
      .eq("exam_id", id)
      .in("candidate_id", body.candidate_ids);
    if (existingError) throw databaseUnavailable();
    const existingIds = new Set((existing ?? []).map((row) => row.candidate_id));
    const rows = body.candidate_ids
      .filter((candidateId) => !existingIds.has(candidateId))
      .map((candidateId) => ({ exam_id: id, candidate_id: candidateId }));
    let addedIds: string[] = [];
    if (rows.length) {
      const { data: added, error: insertError } = await client
        .from("exam_candidates")
        .upsert(rows, { onConflict: "exam_id,candidate_id", ignoreDuplicates: true })
        .select("candidate_id");
      if (insertError) throw databaseUnavailable();
      addedIds = (added ?? []).map((row) => row.candidate_id);
    }
    const alreadyAssigned = body.candidate_ids.length - addedIds.length;
    await recordAdminAction(client, admin, "exam_assign", id, {
      candidate_ids: addedIds,
      added_count: addedIds.length,
      already_assigned_count: alreadyAssigned,
    });
    return jsonResponse({ added: addedIds.length, already_assigned: alreadyAssigned });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await examId(context);
    const body = examCandidateMutationSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("unassign_exam_candidates", {
      p_exam_id: id,
      p_candidate_ids: body.candidate_ids,
    });
    if (error) {
      if (error.message.includes("exam_not_found")) throw examNotFound();
      if (error.message.includes("exam_locked")) {
        throw new ApiError("exam_locked", 409, "The exam has ended, so candidates can no longer be added or removed.");
      }
      throw databaseUnavailable();
    }
    const result = data?.[0] as { removed?: string[]; blocked?: string[] } | undefined;
    const removed = result?.removed ?? [];
    const blockedIds = result?.blocked ?? [];
    const blocked = blockedIds.map((candidateId) => ({
      candidate_id: candidateId,
      reason: "attempt_started" as const,
    }));
    await recordAdminAction(client, admin, "exam_unassign", id, {
      candidate_ids: removed,
      removed_count: removed.length,
      blocked_count: blocked.length,
    });
    return jsonResponse({ removed, blocked });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
