import type { StateBody } from "@/lib/candidate-types";

export type CandidateRouteDecision =
  | { allow: true }
  | { redirect: "/login" | "/confirm" | "/rules" | "/check" | "/waiting" | "/exam" | "/done" }
  | { screen: "ended" | "signed_out" | "please_sign_in" };

export function routeFor({
  state,
  error,
  pathname,
  checkPassed,
}: {
  state: StateBody | null;
  error?: string | null;
  pathname: string;
  checkPassed: boolean;
}): CandidateRouteDecision {
  if (error === "session_revoked") return { screen: "signed_out" };
  if (error === "unauthenticated") return { screen: "please_sign_in" };
  if (!state) return { allow: true };

  const status = state.attempt.status;
  if (status === "submitted" || status === "finalized" || state.phase === "submitted") {
    return pathname === "/done" ? { allow: true } : { redirect: "/done" };
  }
  if (
    state.phase === "closed" &&
    (status === "not_started" || status === "acknowledged")
  ) {
    return { screen: "ended" };
  }
  if (state.phase === "closed" && status === "in_progress") {
    return pathname === "/exam" ? { allow: true } : { redirect: "/exam" };
  }
  if (status === "not_started") {
    return pathname === "/confirm" || pathname === "/rules"
      ? { allow: true }
      : { redirect: "/confirm" };
  }
  if (state.phase === "waiting") {
    if (pathname === "/waiting") return { allow: true };
    if (!checkPassed) return pathname === "/check" ? { allow: true } : { redirect: "/check" };
    return { redirect: "/waiting" };
  }
  if (state.phase === "live") {
    if (pathname === "/waiting" || pathname === "/exam") return { allow: true };
    if (!checkPassed) return pathname === "/check" ? { allow: true } : { redirect: "/check" };
    return { redirect: "/exam" };
  }
  return { allow: true };
}
