import { z } from "zod";

import { ApiError, jsonResponse } from "@/lib/api";
import { candidateRoute, readCandidateJson } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const acknowledgeSchema = z.object({
  identity_confirmed: z.literal(true),
  rules_accepted: z.literal(true),
});

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/auth/acknowledge", async (context) => {
    assertSameOrigin(request);
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    acknowledgeSchema.parse(await readCandidateJson(request));
    const supabase = createServiceRoleClient();
    const { data: exam, error: examError } = await supabase
      .from("exams")
      .select("status")
      .eq("id", auth.examId)
      .single();
    if (examError) throw examError;
    if (exam.status !== "scheduled" && exam.status !== "live") {
      throw new ApiError("exam_closed", 409, "The exam has ended.");
    }
    if (auth.attemptStatus === "submitted" || auth.attemptStatus === "finalized") {
      throw new ApiError("already_submitted", 409, "This exam was already submitted.");
    }
    if (auth.attemptStatus !== "not_started") {
      return jsonResponse({ attempt: { status: auth.attemptStatus } });
    }
    const { data, error } = await supabase
      .from("attempts")
      .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
      .eq("id", auth.attemptId)
      .eq("status", "not_started")
      .select("status")
      .maybeSingle();
    if (error) throw error;
    if (data) return jsonResponse({ attempt: { status: data.status } });

    const { data: current, error: currentError } = await supabase
      .from("attempts")
      .select("status")
      .eq("id", auth.attemptId)
      .single();
    if (currentError) throw currentError;
    if (current.status === "submitted" || current.status === "finalized") {
      throw new ApiError("already_submitted", 409, "This exam was already submitted.");
    }
    return jsonResponse({ attempt: { status: current.status } });
  });
}
