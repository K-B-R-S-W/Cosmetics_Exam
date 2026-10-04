import { jsonResponse } from "@/lib/api";
import { candidateRoute } from "@/lib/candidate-api";

export async function GET(): Promise<Response> {
  return candidateRoute("GET /api/time", async () =>
    jsonResponse({ server_time_ms: Date.now() }),
  );
}
