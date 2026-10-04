// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateBody } from "@/lib/candidate-types";
import { WaitingRoom } from "./WaitingRoom";

const mocks = vi.hoisted(() => ({ push: vi.fn(), refreshState: vi.fn(), now: 0 }));
let currentState: StateBody;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/broadcast", () => ({ useExamBroadcast: vi.fn() }));
vi.mock("@/lib/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time")>();
  return { ...actual, refineServerClock: vi.fn(), useServerClock: () => () => mocks.now };
});
vi.mock("@/components/candidate/CandidateContext", () => ({
  useCandidate: () => ({ state: currentState, refreshState: mocks.refreshState }),
  CandidateFrame: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  CandidateErrorScreen: ({ title }: { title: string }) => <main><h1>{title}</h1><button>Sign out</button></main>,
  Notice: ({ children }: { children: React.ReactNode }) => <div role="status">{children}</div>,
}));

function state(phase: StateBody["phase"], start: string | null): StateBody {
  return { server_time: new Date(mocks.now).toISOString(), phase, exam: { id: "e", title: "Synthetic Exam", status: phase === "live" ? "live" : phase === "closed" ? "ended" : "scheduled", navigation_mode: "free", scheduled_start_at: start, started_at: null, ends_at: null, force_ended: false, question_count: 20 }, attempt: { id: "a", status: phase === "submitted" ? "submitted" : "acknowledged", current_position: 0, extra_minutes: 0, deadline: null, submit_reason: null }, announcements: [] };
}

beforeEach(() => { mocks.now = Date.parse("2026-10-04T10:00:00.000Z"); mocks.push.mockReset(); mocks.refreshState.mockReset().mockResolvedValue(null); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("WaitingRoom", () => {
  it("never shows a negative countdown at 0:00 and polls every three seconds", async () => {
    currentState = state("waiting", "2026-10-04T10:00:00.000Z");
    render(<WaitingRoom />);
    expect(screen.getByText("The exam is starting…")).toBeTruthy();
    expect(screen.queryByText(/-\d/)).toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.refreshState).toHaveBeenCalled();
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
  it("navigates client-side when state becomes live", () => {
    currentState = state("live", "2026-10-04T10:00:00.000Z");
    render(<WaitingRoom />);
    expect(mocks.push).toHaveBeenCalledWith("/exam");
  });
  it("notices a changed scheduled start in Colombo time", () => {
    currentState = state("waiting", "2026-10-05T04:30:00.000Z");
    const view = render(<WaitingRoom />);
    currentState = state("waiting", "2026-10-05T05:30:00.000Z");
    view.rerender(<WaitingRoom />);
    expect(screen.getByText("The start time changed to Mon 5 Oct, 11:00 am.")).toBeTruthy();
  });
});
