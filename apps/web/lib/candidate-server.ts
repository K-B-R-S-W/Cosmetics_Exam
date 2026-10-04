import "server-only";

import { ApiError } from "@/lib/api";
import type { CandidateItem } from "@/lib/candidates";

export {
  databaseUnavailable,
  quotedPostgrestPattern,
  recordAdminAction,
} from "@/lib/admin-server";

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

export function notFound(): ApiError {
  return new ApiError("not_found", 404, "Candidate not found.");
}
