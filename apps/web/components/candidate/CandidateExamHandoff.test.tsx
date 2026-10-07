// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaperBody, StateBody } from "@/lib/candidate-types";

const navigation = vi.hoisted(() => ({
  path: "/waiting",
  push: vi.fn<(path: string) => void>(),
  replace: vi.fn<(path: string) => void>(),
}));
const heartbeat = vi.hoisted(() => ({ emit: null as null | ((state: StateBody) => void) }));
const media = vi.hoisted(() => ({
  status: "connected",
  stream: null,
  mediaTracks: [],
  cameraLost: false,
  microphoneLost: false,
  connectionLost: false,
  acquireAndConnect: vi.fn().mockResolvedValue(true),
  trySilentReacquire: vi.fn().mockResolvedValue(true),
  stop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.path,
  useRouter: () => navigation,
}));
vi.mock("@/hooks/useHeartbeat", () => ({
  useHeartbeat: (onState: (state: StateBody) => void) => {
    heartbeat.emit = onState;
    return vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("@/hooks/useLiveKit", () => ({ useLiveKit: () => media }));
vi.mock("@/lib/broadcast", () => ({ useExamBroadcast: vi.fn() }));
vi.mock("@/lib/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time")>();
  return { ...actual, useServerClock: () => () => Date.parse("2030-01-01T10:00:00.000Z") };
});

import CandidateLayout from "@/app/(candidate)/layout";
import { CheckScreen } from "./CheckScreen";
import { WaitingRoom } from "./WaitingRoom";
import { ExamScreen } from "@/components/exam/ExamScreen";

let paperLoaded = false;
let serverState: StateBody;

function candidateState(phase: "waiting" | "live", status: "acknowledged" | "in_progress"): StateBody {
  return {
    server_time: "2030-01-01T10:00:00.000Z",
    phase,
    exam: {
      id: "exam-1",
      title: "Synthetic Exam",
      status: phase === "live" ? "live" : "scheduled",
      navigation_mode: "free",
      scheduled_start_at: null,
      started_at: phase === "live" ? "2030-01-01T10:00:00.000Z" : null,
      ends_at: phase === "live" ? "2030-01-01T11:00:00.000Z" : null,
      force_ended: false,
      question_count: 1,
    },
    attempt: {
      id: "attempt-1",
      status,
      current_position: 0,
      extra_minutes: 0,
      deadline: phase === "live" ? "2030-01-01T11:00:00.000Z" : null,
      submit_reason: null,
    },
    announcements: [],
  };
}

const paper: PaperBody = {
  server_time: "2030-01-01T10:00:00.000Z",
  navigation_mode: "free",
  total_questions: 1,
  current_position: null,
  questions: [{ id: "question-1", position: 0, type: "written", body_html: "<p>Explain</p>", image: null, marks: 1 }],
  answers: {},
};

function Page() {
  if (navigation.path === "/login") return <p>Login</p>;
  if (navigation.path === "/check") return <CheckScreen />;
  if (navigation.path === "/waiting") return <WaitingRoom />;
  return <ExamScreen />;
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  navigation.path = "/waiting";
  navigation.push.mockReset();
  navigation.replace.mockReset();
  heartbeat.emit = null;
  media.trySilentReacquire.mockClear();
  media.stop.mockClear();
  sessionStorage.clear();
  paperLoaded = false;
  serverState = candidateState("waiting", "acknowledged");
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/exam/state") return json(paperLoaded ? candidateState("live", "in_progress") : serverState);
    if (url === "/api/exam/paper") {
      paperLoaded = true;
      return json(paper);
    }
    if (url === "/api/auth/me") return json({ candidate: { mer_code: "TEST-1", full_name: "Synthetic Candidate", outlet: null }, exam: { id: "exam-1", title: "Synthetic Exam", instructions: null, scheduled_start_at: null, duration_min: 60, navigation_mode: "free", question_count: 1, status: "live" }, attempt: { id: "attempt-1", status: paperLoaded ? "in_progress" : "acknowledged" }, rules: { snapshot_retention_days: 14 } });
    if (url === "/api/events") return json({ id: "event-1" });
    throw new Error(`Unexpected request: ${url}`);
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("candidate exam handoff", () => {
  it("does not record RELOAD during the real Waiting to Exam handoff", async () => {
    const view = render(<CandidateLayout><Page /></CandidateLayout>);
    expect(await screen.findByText("Stay on this page.")).toBeTruthy();

    act(() => heartbeat.emit?.(candidateState("live", "acknowledged")));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/exam"));
    navigation.path = "/exam";
    view.rerender(<CandidateLayout><Page /></CandidateLayout>);
    await screen.findByRole("heading", { name: "Question 1" });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const reloads = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url) === "/api/events")
      .map(([, init]) => JSON.parse(String(init?.body)) as { type: string })
      .filter(({ type }) => type === "RELOAD");
    expect(reloads).toHaveLength(0);
  });

  it("does not record RELOAD when a kicked candidate resets, re-enters through Check and continues to Exam", async () => {
    navigation.path = "/login";
    serverState = candidateState("live", "in_progress");
    const view = render(<CandidateLayout><Page /></CandidateLayout>);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    navigation.path = "/check";
    view.rerender(<CandidateLayout><Page /></CandidateLayout>);
    await screen.findByRole("heading", { name: "Pre-exam check" });
    navigation.push.mockClear();
    screen.getByRole("button", { name: "Continue" }).click();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/exam"));

    navigation.path = "/exam";
    view.rerender(<CandidateLayout><Page /></CandidateLayout>);
    await screen.findByRole("heading", { name: "Question 1" });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const reloads = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url) === "/api/events")
      .map(([, init]) => JSON.parse(String(init?.body)) as { type: string })
      .filter(({ type }) => type === "RELOAD");
    expect(reloads).toHaveLength(0);
  });

  it("records exactly one snapshot-free RELOAD on a direct full page load into an in-progress exam", async () => {
    navigation.path = "/exam";
    serverState = candidateState("live", "in_progress");
    render(<CandidateLayout><Page /></CandidateLayout>);
    await screen.findByRole("heading", { name: "Question 1" });
    await waitFor(() => {
      const reloads = vi.mocked(fetch).mock.calls
        .filter(([url]) => String(url) === "/api/events")
        .map(([, init]) => JSON.parse(String(init?.body)) as { type: string; snapshot_jpeg_base64: string | null })
        .filter(({ type }) => type === "RELOAD");
      expect(reloads).toEqual([expect.objectContaining({ type: "RELOAD", snapshot_jpeg_base64: null })]);
    });
  });
});
