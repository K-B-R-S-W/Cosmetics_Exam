import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import type { AdminContext } from "@/lib/auth";
import type { CandidateItem } from "@/lib/candidates";

export const CANDIDATE_COLUMNS =
  "id, mer_code, full_name, outlet, active, created_at";
export const CANDIDATE_WITH_COUNT = `${CANDIDATE_COLUMNS}, exam_candidates(count)`;

interface CandidateRecord {
  id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  active: boolean;
  created_at: string;
  exam_candidates?: Array<{ count?: number }> | null;
}

export function toCandidateItem(record: CandidateRecord): CandidateItem {
  return {
    id: record.id,
    mer_code: record.mer_code,
    full_name: record.full_name,
    outlet: record.outlet,
    active: record.active,
    created_at: record.created_at,
    assigned_exam_count: record.exam_candidates?.[0]?.count ?? 0,
  };
}

export function quotedPostgrestPattern(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"*${escaped}*"`;
}

export async function recordAdminAction(
  client: SupabaseClient,
  admin: AdminContext,
  action: string,
  target: string | null,
  detail: Record<string, unknown> | null = null,
): Promise<void> {
  const { error } = await client.from("admin_actions").insert({
    admin_id: admin.id,
    action,
    target,
    detail,
  });

  if (error) {
    throw new ApiError(
      "service_unavailable",
      503,
      "The change was saved, but its audit record could not be written. Stop and contact support before retrying.",
    );
  }
}

export function databaseUnavailable(): ApiError {
  return new ApiError(
    "service_unavailable",
    503,
    "The database is unavailable. Try again.",
  );
}

export function notFound(): ApiError {
  return new ApiError("not_found", 404, "Candidate not found.");
}
