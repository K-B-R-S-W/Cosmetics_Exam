import { describe, expect, it } from "vitest";

import type { StateBody } from "./candidate-types";
import { routeFor } from "./candidate-routing";

function state(status: StateBody["attempt"]["status"], phase: StateBody["phase"]): StateBody {
  return {
    server_time: new Date(0).toISOString(), phase,
    exam: { id: "e", title: "Exam", status: phase === "live" ? "live" : "scheduled", navigation_mode: "free", scheduled_start_at: null, started_at: null, ends_at: null, force_ended: false, question_count: 1 },
    attempt: { id: "a", status, current_position: 0, extra_minutes: 0, deadline: null, submit_reason: null },
    announcements: [],
  };
}

describe("routeFor", () => {
  it("maps revoked and absent sessions to their fixed screens", () => {
    expect(routeFor({ state: null, error: "session_revoked", pathname: "/exam", checkPassed: false })).toEqual({ screen: "signed_out" });
    expect(routeFor({ state: null, error: "unauthenticated", pathname: "/exam", checkPassed: false })).toEqual({ screen: "please_sign_in" });
  });
  it("keeps not-started candidates in confirm and rules", () => {
    expect(routeFor({ state: state("not_started", "waiting"), pathname: "/rules", checkPassed: false })).toEqual({ allow: true });
    expect(routeFor({ state: state("not_started", "live"), pathname: "/check", checkPassed: false })).toEqual({ redirect: "/confirm" });
  });
  it("implements waiting and live check gates plus reload exceptions", () => {
    expect(routeFor({ state: state("acknowledged", "waiting"), pathname: "/waiting", checkPassed: false })).toEqual({ allow: true });
    expect(routeFor({ state: state("acknowledged", "waiting"), pathname: "/rules", checkPassed: false })).toEqual({ redirect: "/check" });
    expect(routeFor({ state: state("in_progress", "live"), pathname: "/exam", checkPassed: false })).toEqual({ allow: true });
    expect(routeFor({ state: state("acknowledged", "live"), pathname: "/rules", checkPassed: true })).toEqual({ redirect: "/exam" });
  });
  it("handles closed and completed attempts", () => {
    expect(routeFor({ state: state("acknowledged", "closed"), pathname: "/waiting", checkPassed: true })).toEqual({ screen: "ended" });
    expect(routeFor({ state: state("in_progress", "closed"), pathname: "/waiting", checkPassed: true })).toEqual({ redirect: "/exam" });
    expect(routeFor({ state: state("submitted", "submitted"), pathname: "/exam", checkPassed: true })).toEqual({ redirect: "/done" });
  });
});
