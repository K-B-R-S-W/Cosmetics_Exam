export const runtime = "nodejs";

import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { requireCandidate } from "@/lib/candidate-session";
import {
  buildAdminLiveKitToken,
  buildCandidateLiveKitToken,
  LiveKitConfigurationError,
} from "@/lib/livekit-server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/livekit/token";
const inputSchema = z.discriminatedUnion("as", [
  z.object({ as: z.literal("candidate") }).strict(),
  z.object({ as: z.literal("admin"), exam_id: z.string().uuid() }).strict(),
]);

type CandidateTokenRow = {
  id: string;
  status: string;
  candidate_id: string;
  exam_id: string;
  candidates: { mer_code: string } | Array<{ mer_code: string }>;
  exams: { status: string } | Array<{ status: string }>;
};

function first<T>(value: T | T[]): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await readJson(request));

    if (input.as === "admin") {
      const admin = await requireAdmin();
      return jsonResponse(await buildAdminLiveKitToken({ adminId: admin.id, examId: input.exam_id }));
    }

    const candidate = await requireCandidate();
    const { data, error } = await createServiceRoleClient()
      .from("attempts")
      .select("id,status,candidate_id,exam_id,candidates!inner(mer_code),exams!inner(status)")
      .eq("id", candidate.attemptId)
      .eq("candidate_id", candidate.candidateId)
      .eq("exam_id", candidate.examId)
      .maybeSingle();
    if (error) throw new ApiError("service_unavailable", 503, "Live video is unavailable. Your exam can continue.");

    const row = data as CandidateTokenRow | null;
    const candidateRecord = row ? first(row.candidates) : undefined;
    const exam = row ? first(row.exams) : undefined;
    if (
      !row
      || !candidateRecord
      || !exam
      || !["acknowledged", "in_progress"].includes(row.status)
      || !["scheduled", "live"].includes(exam.status)
    ) {
      throw new ApiError("exam_closed", 409, "The exam has ended.");
    }

    return jsonResponse(await buildCandidateLiveKitToken({
      attemptId: row.id,
      examId: row.exam_id,
      merCode: candidateRecord.mer_code,
    }));
  } catch (error) {
    if (error instanceof LiveKitConfigurationError) {
      return new ApiError("service_unavailable", 503, "Live video is unavailable. Your exam can continue.").toResponse();
    }
    return apiErrorResponse(error, ROUTE);
  }
}
