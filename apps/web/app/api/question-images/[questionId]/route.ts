import { z } from "zod";

import { ApiError } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { requireCandidate } from "@/lib/candidate-session";
import { QUESTION_BUCKET } from "@/lib/question-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ImageMembershipRow = {
  questions:
    | { image_path: string | null; image_mime: string | null }
    | Array<{ image_path: string | null; image_mime: string | null }>
    | null;
};

const questionIdSchema = z.string().uuid();

function notFound(): ApiError {
  return new ApiError("not_found", 404, "The image was not found.");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ questionId: string }> },
): Promise<Response> {
  const response = await candidateRoute("GET /api/question-images/[questionId]", async (context) => {
    const auth = await requireCandidate();
    context.setCandidateId(auth.candidateId);
    const questionId = questionIdSchema.parse((await params).questionId);
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("attempt_questions")
      .select("question_id,questions!inner(image_path,image_mime)")
      .eq("attempt_id", auth.attemptId)
      .eq("question_id", questionId)
      .maybeSingle();
    if (error) throw error;
    const joined = (data as ImageMembershipRow | null)?.questions;
    const question = Array.isArray(joined) ? joined[0] : joined;
    if (!question?.image_path || !question.image_mime) throw notFound();

    const { data: object, error: storageError } = await supabase.storage
      .from(QUESTION_BUCKET)
      .download(question.image_path);
    if (storageError || !object) throw notFound();
    return new Response(object.stream(), {
      headers: {
        "Content-Type": question.image_mime,
        "Content-Length": String(object.size),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  if (response.ok) response.headers.set("Cache-Control", "private, max-age=300, no-transform");
  return response;
}
