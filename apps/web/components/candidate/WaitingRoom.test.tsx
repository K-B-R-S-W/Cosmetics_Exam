// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateBody } from "@/lib/candidate-types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refreshState: vi.fn(), loadPaper: vi.fn(), now: 0 }));
let currentState: StateBody;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/broadcast", () => ({ useExamBroadcast: vi.fn() }));
vi.mock("@/lib/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time")>();
  return { ...actual, refineServerClock: vi.fn(), useServerClock: () => () => mocks.now };
});
vi.mock("@/components/candidate/CandidateContext", () => {
  class CandidatePaperError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  }
  return {
    CandidatePaperError,
    useCandidate: () => ({ state: currentState, refreshState: mocks.refreshState, loadPaper: mocks.loadPaper }),
    CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
    CandidateErrorScreen: ({ title }: { title: string }) => <main><h1>{title}</h1><button>Sign out</button></main>,
    Notice: ({ children }: { children: React.ReactNode }) => <div role="status">{children}</div>,
  };
});

import { CandidatePaperError } from "@/components/candidate/CandidateContext";
import { WaitingRoom } from "./WaitingRoom";

function state(phase: StateBody["phase"], start: string | null, attemptStatus: StateBody["attempt"]["status"] = "acknowledged"): StateBody {
  return { server_time: new Date(mocks.now).toISOString(), phase, exam: { id: "e", title: "Synthetic Exam", status: phase === "live" ? "live" : phase === "closed" ? "ended" : "scheduled", navigation_mode: "free", scheduled_start_at: start, started_at: null, ends_at: phase === "live" ? "2026-10-04T11:00:00.000Z" : null, force_ended: false, question_count: 20 }, attempt: { id: "a", status: phase === "submitted" ? "submitted" : attemptStatus, current_position: 0, extra_minutes: 0, deadline: phase === "live" ? "2026-10-04T11:00:00.000Z" : null, submit_reason: null }, announcements: [] };
}

beforeEach(() => {
  mocks.now = Date.parse("2026-10-04T10:00:00.000Z");
  mocks.push.mockReset();
  mocks.refreshState.mockReset().mockImplementation(async () => currentState);
  mocks.loadPaper.mockReset().mockResolvedValue({});
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve(); });
}

describe("WaitingRoom", () => {
  it("never shows a negative countdown at 0:00 and polls every three seconds", async () => {
    currentState = state("waiting", "2026-10-04T10:00:00.000Z");
    render(<WaitingRoom />);
    expect(screen.getByText("The exam is starting…")).toBeTruthy();
    expect(screen.queryByText(/-\d/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(mocks.refreshState).toHaveBeenCalled();
  });

  it("loads one paper, refreshes status, then navigates client-side", async () => {
    currentState = state("live", "2026-10-04T10:00:00.000Z");
    render(<WaitingRoom />);
    await flush();
    expect(mocks.loadPaper).toHaveBeenCalledTimes(1);
    expect(mocks.refreshState).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/exam");
  });

  it("takes the mocked 60 ms paper-plus-refresh path before /exam is usable", async () => {
    currentState = state("live", "2026-10-04T10:00:00.000Z");
    mocks.loadPaper.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 40)));
    mocks.refreshState.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(currentState), 20)));
    render(<WaitingRoom />);
    await act(() => vi.advanceTimersByTimeAsync(59));
    expect(mocks.push).not.toHaveBeenCalledWith("/exam");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(mocks.push).toHaveBeenCalledWith("/exam");
  });

  it("retries transient failures every five seconds and reveals manual Retry after eight", async () => {
    currentState = state("live", null);
    mocks.loadPaper.mockRejectedValue(new Error("network"));
    render(<WaitingRoom />);
    await flush();
    expect(mocks.loadPaper).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await flush();
    expect(mocks.loadPaper).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush();
    expect(mocks.loadPaper).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["not_acknowledged", 403, "/rules"],
    ["attempt_closed", 409, "/done"],
    ["exam_not_live", 409, null],
    ["exam_has_no_questions", 409, null],
    ["exam_closed", 409, null],
    ["session_revoked", 401, null],
  ])("does not retry permanent %s", async (code, status, destination) => {
    currentState = state("live", null);
    mocks.loadPaper.mockRejectedValue(new CandidatePaperError(code, status));
    render(<WaitingRoom />);
    await flush();
    expect(mocks.loadPaper).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(mocks.loadPaper).toHaveBeenCalledTimes(1);
    if (destination) expect(mocks.push).toHaveBeenCalledWith(destination);
  });

  it("shows the ended screen without making a submit call", () => {
    currentState = state("closed", null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitingRoom />);
    expect(screen.getByRole("heading", { name: "This exam has ended." })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
