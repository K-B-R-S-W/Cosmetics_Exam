import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { hashNic } from "@/lib/hashing";

export const LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const MER_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 200;
const DUMMY_NIC = "200012345678";

let dummyHashPromise: Promise<string> | undefined;

export function getDummyNicHash(): Promise<string> {
  dummyHashPromise ??= hashNic(DUMMY_NIC);
  return dummyHashPromise;
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",", 1)[0]?.trim() || null;
}

export function replacementIncident(
  lastSeenAt: string | null,
  nowMs = Date.now(),
): { type: "MULTI_LOGIN" | "RECONNECTED"; counts: boolean } {
  const isLive =
    lastSeenAt !== null &&
    nowMs - new Date(lastSeenAt).getTime() <= 30_000;
  return isLive
    ? { type: "MULTI_LOGIN", counts: true }
    : { type: "RECONNECTED", counts: false };
}

/**
 * If n failures are in the window and the limit is L, n-L+1 failures must
 * expire before the count is below L. With ascending timestamps that is index
 * n-L. The result rounds up so a client never retries inside the blocked ms.
 */
export function retryAfterSeconds(
  ascendingAttemptTimes: string[],
  limit: number,
  nowMs: number,
): number {
  if (ascendingAttemptTimes.length < limit) return 0;
  const releaseIndex = ascendingAttemptTimes.length - limit;
  const releaseAt =
    new Date(ascendingAttemptTimes[releaseIndex]!).getTime() + LOGIN_WINDOW_MS;
  return Math.max(1, Math.ceil((releaseAt - nowMs) / 1000));
}

async function failedAttempts(
  supabase: SupabaseClient,
  column: "mer_code" | "ip",
  value: string,
  since: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("login_attempts")
    .select("attempted_at")
    .eq("success", false)
    .eq(column, value)
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => String(row.attempted_at));
}

export async function assertLoginAllowed(
  supabase: SupabaseClient,
  merCode: string,
  ip: string | null,
  now = new Date(),
): Promise<void> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const [merAttempts, ipAttempts] = await Promise.all([
    failedAttempts(supabase, "mer_code", merCode, since),
    ip ? failedAttempts(supabase, "ip", ip, since) : Promise.resolve([]),
  ]);
  const waits = [
    retryAfterSeconds(merAttempts, MER_FAILURE_LIMIT, now.getTime()),
    retryAfterSeconds(ipAttempts, IP_FAILURE_LIMIT, now.getTime()),
  ];
  const retryAfter = Math.max(...waits);
  if (retryAfter > 0) {
    throw new ApiError(
      "rate_limited",
      429,
      "Too many tries. Wait and try again.",
      { retry_after_s: retryAfter },
    );
  }
}

export type EligibleExam = {
  id: string;
  title: string;
  status: "scheduled" | "live";
  scheduled_start_at: string | null;
  duration_min: number;
};

export function pickExam(
  assigned: Array<EligibleExam & { raw_status: string }>,
  requestedExamId?: string,
): EligibleExam {
  const eligible = assigned.filter(
    (exam) => exam.raw_status === "scheduled" || exam.raw_status === "live",
  );
  if (eligible.length === 0) {
    if (assigned.some((exam) => exam.raw_status === "ended" || exam.raw_status === "finalized")) {
      throw new ApiError("exam_closed", 403, "This exam has ended.");
    }
    throw new ApiError(
      "no_exam_available",
      403,
      "No exam is open for you right now. Ask the exam team.",
    );
  }
  if (requestedExamId) {
    const selected = eligible.find((exam) => exam.id === requestedExamId);
    if (!selected) {
      throw new ApiError(
        "not_assigned",
        403,
        "You aren't assigned to that exam. Ask the exam team.",
      );
    }
    return selected;
  }
  if (eligible.length > 1) {
    throw new ApiError("multiple_exams", 409, "Choose an exam to continue.", {
      exams: eligible.map(({ id, title, status, scheduled_start_at }) => ({
        id,
        title,
        status,
        scheduled_start_at,
      })),
    });
  }
  return eligible[0]!;
}
