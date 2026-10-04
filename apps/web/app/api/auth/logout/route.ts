import { jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";
import { readCandidateSessionId } from "@/lib/candidate-session";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<Response> {
  return candidateRoute("POST /api/auth/logout", async () => {
    assertSameOrigin(request);
    const { session, sessionId } = await readCandidateSessionId();
    if (sessionId) {
      const { error } = await createServiceRoleClient()
        .from("sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", sessionId)
        .is("revoked_at", null);
      if (error) throw error;
    }
    session.destroy();
    return jsonResponse({ ok: true });
  });
}
