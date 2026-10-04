import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import {
  CANDIDATE_COLUMNS,
  CANDIDATE_WITH_COUNT,
  databaseUnavailable,
  notFound,
  recordAdminAction,
  toCandidateItem,
} from "@/lib/candidate-server";
import { updateCandidateSchema } from "@/lib/candidates";
import { hashNic, InvalidNicError } from "@/lib/hashing";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/candidates/[id]";
const idSchema = z.uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function candidateId(context: RouteContext): Promise<string> {
  const result = idSchema.safeParse((await context.params).id);
  if (!result.success) {
    throw notFound();
  }
  return result.data;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    await requireAdmin();
    const id = await candidateId(context);
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("candidates")
      .select(CANDIDATE_WITH_COUNT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw databaseUnavailable();
    }
    if (!data) {
      throw notFound();
    }

    return jsonResponse({ candidate: toCandidateItem(data as never) });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await candidateId(context);
    const body = updateCandidateSchema.parse(await readJson(request));
    const changes: Record<string, unknown> = {};

    if (body.full_name !== undefined) changes.full_name = body.full_name;
    if (body.outlet !== undefined) changes.outlet = body.outlet;
    if (body.active !== undefined) changes.active = body.active;

    if (body.nic !== undefined && body.nic.trim() !== "") {
      try {
        changes.nic_hash = await hashNic(body.nic);
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
    }

    const client = createServiceRoleClient();

    if (Object.keys(changes).length === 0) {
      const { data, error } = await client
        .from("candidates")
        .select(CANDIDATE_WITH_COUNT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw databaseUnavailable();
      if (!data) throw notFound();
      return jsonResponse({ candidate: toCandidateItem(data as never) });
    }

    const { data, error } = await client
      .from("candidates")
      .update(changes)
      .eq("id", id)
      .select(CANDIDATE_COLUMNS)
      .maybeSingle();

    if (error) throw databaseUnavailable();
    if (!data) throw notFound();

    await recordAdminAction(client, admin, "candidate_update", id, {
      fields: Object.keys(changes).map((field) =>
        field === "nic_hash" ? "nic" : field,
      ),
    });

    return jsonResponse({
      candidate: toCandidateItem({ ...data, exam_candidates: [] }),
    });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = await candidateId(context);
    const client = createServiceRoleClient();
    const { data: startedAttempts, error: guardError } = await client
      .from("attempts")
      .select("id")
      .eq("candidate_id", id)
      .neq("status", "not_started")
      .limit(1);

    if (guardError) throw databaseUnavailable();
    if ((startedAttempts?.length ?? 0) > 0) {
      throw new ApiError(
        "has_attempts",
        409,
        "This candidate has taken part in an exam, so they can't be deleted. Mark them inactive instead.",
      );
    }

    const { data, error } = await client
      .from("candidates")
      .delete()
      .eq("id", id)
      .select("id, mer_code")
      .maybeSingle();

    if (error) throw databaseUnavailable();
    if (!data) throw notFound();

    await recordAdminAction(client, admin, "candidate_delete", id, {
      mer_code: data.mer_code,
    });

    return jsonResponse({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
