import { jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { createServiceRoleClient } from "@/lib/supabase/server";

function retentionDays(): number {
  const raw = process.env.SNAPSHOT_RETENTION_DAYS ?? "14";
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("SNAPSHOT_RETENTION_DAYS must be a positive integer");
  }
  return value;
}

export async function GET(): Promise<Response> {
  return candidateRoute("GET /api/auth/me", async (context) => {
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const supabase = createServiceRoleClient();
    const [candidateResult, examResult, countResult] = await Promise.all([
      supabase
        .from("candidates")
        .select("mer_code,full_name,outlet")
        .eq("id", auth.candidateId)
        .single(),
      supabase
        .from("exams")
        .select("id,title,instructions,scheduled_start_at,duration_min,navigation_mode,status")
        .eq("id", auth.examId)
        .single(),
      supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("exam_id", auth.examId),
    ]);
    if (candidateResult.error) throw candidateResult.error;
    if (examResult.error) throw examResult.error;
    if (countResult.error) throw countResult.error;

    return jsonResponse({
      candidate: candidateResult.data,
      exam: { ...examResult.data, question_count: countResult.count ?? 0 },
      attempt: { id: auth.attemptId, status: auth.attemptStatus },
      rules: { snapshot_retention_days: retentionDays() },
    });
  });
}
