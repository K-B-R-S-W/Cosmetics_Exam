import type { SessionOptions } from "iron-session";

export interface CandidateSessionData {
  sid?: string;
}

export const CANDIDATE_SESSION_COOKIE = "exam_session";
export const SESSION_GRACE_SECONDS = 2 * 60 * 60;

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;

  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  return value;
}

export function sessionOptionsForExam(durationMinutes: number): SessionOptions {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Exam duration must be a positive whole number of minutes");
  }

  const ttl = durationMinutes * 60 + SESSION_GRACE_SECONDS;

  return {
    password: sessionSecret(),
    cookieName: CANDIDATE_SESSION_COOKIE,
    ttl,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ttl - 60,
    },
  };
}
