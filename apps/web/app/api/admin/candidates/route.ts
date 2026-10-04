import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import {
  CANDIDATE_COLUMNS,
  CANDIDATE_WITH_COUNT,
  databaseUnavailable,
  quotedPostgrestPattern,
  recordAdminAction,
  toCandidateItem,
} from "@/lib/candidate-server";
import {
  candidateListQuerySchema,
  createCandidateSchema,
} from "@/lib/candidates";
import { hashNic, InvalidNicError } from "@/lib/hashing";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/candidates";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();

    const url = new URL(request.url);
    const query = candidateListQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    const client = createServiceRoleClient();
    const offset = (query.page - 1) * query.page_size;
    const select = query.exam_id
      ? `${CANDIDATE_WITH_COUNT}, exam_match:exam_candidates!inner(exam_id)`
      : CANDIDATE_WITH_COUNT;
    let candidateQuery = client
      .from("candidates")
      .select(select, { count: "exact" })
      .order("mer_code", { ascending: true })
      .range(offset, offset + query.page_size - 1);

    if (query.active !== "all") {
      candidateQuery = candidateQuery.eq("active", query.active === "true");
    }

    if (query.exam_id) {
      candidateQuery = candidateQuery.eq("exam_match.exam_id", query.exam_id);
    }

    if (query.q) {
      const pattern = quotedPostgrestPattern(query.q);
      candidateQuery = candidateQuery.or(
        `mer_code.ilike.${pattern},full_name.ilike.${pattern},outlet.ilike.${pattern}`,
      );
    }

    const [candidateResult, examResult] = await Promise.all([
      candidateQuery,
      query.include === "exam_options"
        ? client
            .from("exams")
            .select("id, title, status")
            .order("created_at", { ascending: false })
        : Promise.resolve(null),
    ]);

    if (candidateResult.error || examResult?.error) {
      throw databaseUnavailable();
    }

    const response: Record<string, unknown> = {
      items: (candidateResult.data ?? []).map((record) =>
        toCandidateItem(record as never),
      ),
      total: candidateResult.count ?? 0,
    };

    if (examResult) {
      response.exam_options = examResult.data ?? [];
    }

    return jsonResponse(response);
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = createCandidateSchema.parse(await readJson(request));
    let nicHash: string;

    try {
      nicHash = await hashNic(body.nic);
    } catch (error) {
      if (error instanceof InvalidNicError) {
        throw new ApiError(
          "invalid_nic",
          400,
          "This ID number isn't valid.",
        );
      }
      throw error;
    }

    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("candidates")
      .insert({
        mer_code: body.mer_code,
        full_name: body.full_name,
        outlet: body.outlet ?? null,
        nic_hash: nicHash,
      })
      .select(CANDIDATE_COLUMNS)
      .single();

    if (error?.code === "23505") {
      throw new ApiError(
        "duplicate_mer",
        409,
        "That MER code already exists.",
      );
    }

    if (error || !data) {
      throw databaseUnavailable();
    }

    await recordAdminAction(client, admin, "candidate_create", data.id, {
      mer_code: data.mer_code,
    });

    return jsonResponse(
      { candidate: toCandidateItem({ ...data, exam_candidates: [] }) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse(error, ROUTE);
    }
    return apiErrorResponse(error, ROUTE);
  }
}
