import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { extendExamSchema } from "@/lib/admin-controls";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { publishExamBroadcast } from "@/lib/broadcast-server";
import { examIdSchema } from "@/lib/exams";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/extend";
const MAX_RETRIES = 3;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const id = examIdSchema.parse((await context.params).id);
    const input = extendExamSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (input.attempt_id) {
        const { data: current, error } = await client.from("attempts").select("id,exam_id,status,extra_minutes,exams!inner(ends_at,status,force_ended_at)").eq("id", input.attempt_id).eq("exam_id", id).maybeSingle();
        if (error) throw new Error("attempt_extend_load_failed");
        if (!current) throw new ApiError("not_found", 404, "Attempt not found.");
        const exam = (Array.isArray(current.exams) ? current.exams[0] : current.exams) as { ends_at: string | null; status: string; force_ended_at: string | null };
        const deadline = exam.ends_at ? Date.parse(exam.ends_at) + Number(current.extra_minutes) * 60_000 : 0;
        if (!(["acknowledged", "in_progress"].includes(current.status)) || exam.status !== "live" || exam.force_ended_at || Date.now() >= deadline) throw new ApiError("deadline_passed", 409, "This candidate's time is already up or they have submitted.");
        const next = Number(current.extra_minutes) + input.minutes;
        const { data: updated, error: updateError } = await client.from("attempts").update({ extra_minutes: next }).eq("id", input.attempt_id).eq("extra_minutes", current.extra_minutes).select("id,extra_minutes").maybeSingle();
        if (updateError) throw new Error("attempt_extend_update_failed");
        if (!updated) continue;
        const result = { id: updated.id, extra_minutes: updated.extra_minutes, deadline: new Date(Date.parse(exam.ends_at!) + Number(updated.extra_minutes) * 60_000).toISOString() };
        await recordAdminAction(client, admin, "extend", input.attempt_id, { exam_id: id, minutes: input.minutes, scope: "attempt" });
        await publishExamBroadcast(id, { type: "attempt_changed", attempt_id: input.attempt_id });
        return jsonResponse({ attempt: result });
      }
      const { data: current, error } = await client.from("exams").select("id,status,ends_at,force_ended_at").eq("id", id).maybeSingle();
      if (error) throw new Error("exam_extend_load_failed");
      if (!current) throw new ApiError("not_found", 404, "Exam not found.");
      if (current.status !== "live" || current.force_ended_at || !current.ends_at || Date.now() >= Date.parse(current.ends_at)) throw new ApiError("deadline_passed", 409, "The time is already up, so it can't be extended.");
      const next = new Date(Date.parse(current.ends_at) + input.minutes * 60_000).toISOString();
      const { data: updated, error: updateError } = await client.from("exams").update({ ends_at: next }).eq("id", id).eq("ends_at", current.ends_at).select("ends_at").maybeSingle();
      if (updateError) throw new Error("exam_extend_update_failed");
      if (!updated) continue;
      await recordAdminAction(client, admin, "extend", id, { minutes: input.minutes, scope: "exam" });
      await publishExamBroadcast(id, { type: "time_updated" });
      return jsonResponse({ ends_at: updated.ends_at });
    }
    throw new ApiError("concurrent_update", 409, "Someone else changed the time at the same moment. Check the time shown and try again.");
  } catch (error) { return apiErrorResponse(error, ROUTE); }
}
