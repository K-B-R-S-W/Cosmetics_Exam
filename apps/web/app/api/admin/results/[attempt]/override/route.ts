import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { overrideSchema } from "@/lib/grading/contracts";
import { recomputeResults } from "@/lib/grading/recompute";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { z } from "zod";

const ROUTE = "/api/admin/results/[attempt]/override";
export async function POST(request: Request, context: { params: Promise<{ attempt: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const attemptId = z.uuid().parse((await context.params).attempt);
    const body = overrideSchema.parse(await readJson(request)); const client = createServiceRoleClient();
    const { data: attempt, error: attemptError } = await client.from("attempts").select("id,status").eq("id", attemptId).maybeSingle();
    if (attemptError) throw new Error("attempt_lookup_failed"); if (!attempt) throw new ApiError("not_found", 404, "Attempt not found.");
    if (attempt.status !== "finalized") throw new ApiError("not_finalized", 409, "The attempt is not finalized.");
    const { data: question, error: questionError } = await client.from("attempt_questions").select("question_id,questions!inner(marks)").eq("attempt_id", attemptId).eq("question_id", body.question_id).maybeSingle();
    if (questionError) throw new Error("question_lookup_failed"); if (!question) throw new ApiError("not_in_paper", 400, "The question is not in this candidate's paper.");
    const marks = Number((question.questions as unknown as { marks: number }).marks);
    if (body.marks > marks) throw new ApiError("marks_out_of_range", 400, "Marks cannot exceed the question marks.");
    const { data, error } = await client.from("question_scores").insert({ attempt_id: attemptId, question_id: body.question_id, source: "override", marks: body.marks, max_marks: marks, note: body.note, created_by: admin.id, needs_review: false }).select("id").single();
    if (error) throw new Error("override_insert_failed"); const results = await recomputeResults(client, attemptId);
    await recordAdminAction(client, admin, "override", attemptId, { question_id: body.question_id, score_id: data.id });
    return jsonResponse({ current: { question_id: body.question_id, marks: body.marks, max_marks: marks, source: "override" }, results });
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
