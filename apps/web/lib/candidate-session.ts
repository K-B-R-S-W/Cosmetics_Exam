import "server-only";

import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";

import { ApiError } from "@/lib/api";
import {
  candidateSessionReadOptions,
  type CandidateSessionData,
  sessionOptionsForExam,
} from "@/lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";

export interface CandidateAuthContext {
  sessionId: string;
  candidateId: string;
  attemptId: string;
  examId: string;
  attemptStatus:
    | "not_started"
    | "acknowledged"
    | "in_progress"
    | "submitted"
    | "finalized";
  currentPosition: number;
  extraMinutes: number;
  submitReason: "manual" | "auto" | "forced" | null;
}

type SessionAttemptRow = {
  id: string;
  candidate_id: string;
  revoked_at: string | null;
  attempts:
    | { id: string; exam_id: string; status: CandidateAuthContext["attemptStatus"]; current_position: number; extra_minutes: number; submit_reason: CandidateAuthContext["submitReason"] }
    | { id: string; exam_id: string; status: CandidateAuthContext["attemptStatus"]; current_position: number; extra_minutes: number; submit_reason: CandidateAuthContext["submitReason"] }[]
    | null;
};

async function readCandidateCookie(): Promise<IronSession<CandidateSessionData>> {
  return getIronSession<CandidateSessionData>(
    await cookies(),
    candidateSessionReadOptions(),
  );
}

export async function requireCandidate(): Promise<CandidateAuthContext> {
  const cookie = await readCandidateCookie();
  if (!cookie.sid) {
    throw new ApiError(
      "unauthenticated",
      401,
      "Please sign in to continue.",
    );
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id,candidate_id,revoked_at,attempts!sessions_attempt_id_fkey(id,exam_id,status,current_position,extra_minutes,submit_reason)")
    .eq("id", cookie.sid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as SessionAttemptRow | null;
  if (!row || row.revoked_at) {
    throw new ApiError(
      "session_revoked",
      401,
      "This session is no longer active.",
    );
  }

  const attempt = Array.isArray(row.attempts) ? row.attempts[0] : row.attempts;
  if (!attempt) {
    throw new ApiError(
      "session_revoked",
      401,
      "This session is no longer active.",
    );
  }

  return {
    sessionId: row.id,
    candidateId: row.candidate_id,
    attemptId: attempt.id,
    examId: attempt.exam_id,
    attemptStatus: attempt.status,
    currentPosition: attempt.current_position,
    extraMinutes: attempt.extra_minutes,
    submitReason: attempt.submit_reason,
  };
}

export async function createCandidateSession(
  sessionId: string,
  durationMinutes: number,
): Promise<void> {
  const session = await getIronSession<CandidateSessionData>(
    await cookies(),
    sessionOptionsForExam(durationMinutes),
  );
  session.sid = sessionId;
  await session.save();
}

export async function readCandidateSessionId(): Promise<{
  session: IronSession<CandidateSessionData>;
  sessionId?: string;
}> {
  const session = await readCandidateCookie();
  return { session, sessionId: session.sid };
}
