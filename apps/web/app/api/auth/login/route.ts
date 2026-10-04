import { z } from "zod";

import { ApiError, jsonResponse } from "@/lib/api";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import {
  assertLoginAllowed,
  clientIp,
  getDummyNicHash,
  pickExam,
  replacementIncident,
} from "@/lib/candidate-login";
import { createCandidateSession } from "@/lib/candidate-session";
import { verifyNic } from "@/lib/hashing";
import { normalizeMer } from "@/lib/mer";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  mer_code: z.string().trim().min(1).max(64).transform(normalizeMer),
  nic: z.string().min(1).max(20),
  exam_id: z.uuid().optional(),
});

const INVALID_CREDENTIALS =
  "Your MER code or ID number doesn't match our records. Check both and try again. If it still doesn't work, ask the exam team.";

type CandidateRow = {
  id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  nic_hash: string;
  active: boolean;
};

type AssignmentRow = {
  exams:
    | {
        id: string;
        title: string;
        status: string;
        scheduled_start_at: string | null;
        duration_min: number;
      }
    | Array<{
        id: string;
        title: string;
        status: string;
        scheduled_start_at: string | null;
        duration_min: number;
      }>;
};

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/auth/login", async (context) => {
    assertSameOrigin(request);
    const input = loginSchema.parse(await readCandidateJson(request));
    const supabase = createServiceRoleClient();
    const ip = clientIp(request);
    await assertLoginAllowed(supabase, input.mer_code, ip);

    const { data: candidateData, error: candidateError } = await supabase
      .from("candidates")
      .select("id,mer_code,full_name,outlet,nic_hash,active")
      .eq("mer_code", input.mer_code)
      .maybeSingle();
    if (candidateError) throw candidateError;

    const candidate = candidateData as CandidateRow | null;
    const comparisonHash = candidate?.nic_hash ?? (await getDummyNicHash());
    const credentialsMatch = await verifyNic(input.nic, comparisonHash);
    if (!candidate || !candidate.active || !credentialsMatch) {
      const { error } = await supabase.from("login_attempts").insert({
        mer_code: input.mer_code,
        ip,
        success: false,
      });
      if (error) throw error;
      throw new ApiError("invalid_credentials", 401, INVALID_CREDENTIALS);
    }

    context.setCandidateId(candidate.id);
    const { error: successError } = await supabase
      .from("login_attempts")
      .insert({ mer_code: input.mer_code, ip, success: true });
    if (successError) throw successError;

    const { data: assignmentData, error: assignmentError } = await supabase
      .from("exam_candidates")
      .select("exams!inner(id,title,status,scheduled_start_at,duration_min)")
      .eq("candidate_id", candidate.id);
    if (assignmentError) throw assignmentError;

    const assigned = (assignmentData as AssignmentRow[] | null ?? []).map((row) => {
      const exam = Array.isArray(row.exams) ? row.exams[0]! : row.exams;
      return {
        ...exam,
        raw_status: exam.status,
        status: exam.status as "scheduled" | "live",
      };
    });
    const exam = pickExam(assigned, input.exam_id);

    const initialAttempt = await supabase
      .from("attempts")
      .select("id,status,last_seen_at")
      .eq("exam_id", exam.id)
      .eq("candidate_id", candidate.id)
      .maybeSingle();
    let attemptData = initialAttempt.data;
    if (initialAttempt.error) throw initialAttempt.error;
    if (!attemptData) {
      const result = await supabase
        .from("attempts")
        .insert({ exam_id: exam.id, candidate_id: candidate.id })
        .select("id,status,last_seen_at")
        .single();
      if (result.error) throw result.error;
      attemptData = result.data;
    }
    const attempt = attemptData as {
      id: string;
      status: "not_started" | "acknowledged" | "in_progress" | "submitted" | "finalized";
      last_seen_at: string | null;
    };
    if (attempt.status === "submitted" || attempt.status === "finalized") {
      throw new ApiError(
        "already_submitted",
        409,
        "You have already submitted this exam, so you can't sign in again.",
      );
    }

    const revokedAt = new Date().toISOString();
    const { data: revoked, error: revokeError } = await supabase
      .from("sessions")
      .update({ revoked_at: revokedAt })
      .eq("candidate_id", candidate.id)
      .is("revoked_at", null)
      .select("id,ip,created_at");
    if (revokeError) throw revokeError;

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        candidate_id: candidate.id,
        attempt_id: attempt.id,
        ip,
        user_agent: request.headers.get("user-agent"),
      })
      .select("id")
      .single();
    if (sessionError) throw sessionError;

    if ((revoked?.length ?? 0) > 0 && attempt.status === "in_progress") {
      const incident = replacementIncident(attempt.last_seen_at);
      const previous = [...(revoked ?? [])].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )[0];
      const { error: eventError } = await supabase
        .from("violation_events")
        .insert({
          attempt_id: attempt.id,
          type: incident.type,
          merged_types: [],
          counts: incident.counts,
          meta: incident.type === "MULTI_LOGIN"
            ? { previous_ip: previous?.ip ?? null, new_ip: ip }
            : null,
        });
      if (eventError) throw eventError;
    }

    await createCandidateSession(String(session.id), exam.duration_min);
    return jsonResponse({
      next: attempt.status === "not_started" ? "confirm" : "check",
      candidate: {
        mer_code: candidate.mer_code,
        full_name: candidate.full_name,
        outlet: candidate.outlet,
      },
      exam: { id: exam.id, title: exam.title },
      attempt: { status: attempt.status },
    });
  });
}
