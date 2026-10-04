// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperBody, StateBody } from "@/lib/candidate-types";

const mocks = vi.hoisted(() => ({ push: vi.fn(), context: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/time", () => ({ refineServerClock: vi.fn(), useServerClock: () => () => Date.parse("2026-10-04T10:00:00.000Z") }));
vi.mock("@/components/candidate/CandidateContext", () => {
  class CandidatePaperError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  }
  return {
    CandidatePaperError,
    useCandidate: () => mocks.context,
    Notice: ({ children }: { children: React.ReactNode }) => <div role="status">{children}</div>,
    CandidateErrorScreen: ({ title, body }: { title: string; body: string }) => <main><h1>{title}</h1><p>{body}</p></main>,
  };
});

import { CandidatePaperError } from "@/components/candidate/CandidateContext";
import { ExamScreen } from "./ExamScreen";

function state(status: "acknowledged" | "in_progress" = "in_progress", phase: StateBody["phase"] = "live"): StateBody {
  return { server_time: "2026-10-04T10:00:00.000Z", phase, exam: { id: "e", title: "Synthetic විභාගය", status: phase === "closed" ? "ended" : "live", navigation_mode: "free", scheduled_start_at: null, started_at: "2026-10-04T10:00:00.000Z", ends_at: "2026-10-04T11:00:00.000Z", force_ended: false, question_count: 2 }, attempt: { id: "a", status, current_position: 0, extra_minutes: 0, deadline: "2026-10-04T11:00:00.000Z", submit_reason: null }, announcements: [] };
}

function paper(mode: "free" | "sequential" = "free"): PaperBody {
  const questions = [
    { id: "q1", position: 0, type: "mcq" as const, body_html: "<p>Choose</p>", image: null, marks: 1, options: [{ id: "o1", text_html: "<p>එක</p>" }, { id: "o2", text_html: "<p>Two</p>" }] },
    { id: "q2", position: 1, type: "written" as const, body_html: "<p>Explain</p>", image: null, marks: 2 },
  ];
  return { server_time: "2026-10-04T10:00:00.000Z", navigation_mode: mode, total_questions: 2, current_position: mode === "free" ? null : 0, questions: mode === "free" ? questions : [questions[0]!], answers: {} };
}

beforeEach(() => {
  mocks.push.mockReset();
  const value = paper();
  mocks.context = { state: state(), me: { candidate: { full_name: "Candidate", mer_code: "TEST" } }, paper: value, loadMe: vi.fn(), loadPaper: vi.fn().mockResolvedValue(value), refreshState: vi.fn().mockResolvedValue(state()) };
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ExamScreen", () => {
  it("keeps free-mode answers and navigation in memory and ignores current_position", () => {
    const value = { ...paper(), current_position: 99 };
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    expect(screen.getByText("Candidate · TEST")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Question 1" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Question 2" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Synthetic answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(screen.getByRole("heading", { name: "Review your answers" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit exam" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Answers are not saved yet (Phase 2 batch 3)").length).toBeGreaterThan(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("shows only the current sequential question and disables Next", () => {
    const value = paper("sequential");
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next question" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  });

  it("shows the ended screen for acknowledged exam_closed", async () => {
    mocks.context.paper = null;
    mocks.context.state = state("acknowledged");
    mocks.context.loadPaper = vi.fn().mockRejectedValue(new CandidatePaperError("exam_closed", 409));
    mocks.context.refreshState = vi.fn().mockResolvedValue(state("acknowledged", "closed"));
    render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "This exam has ended." })).toBeTruthy();
  });

  it("keeps an in-progress exam_closed attempt locked with no questions", async () => {
    mocks.context.paper = null;
    mocks.context.state = state("in_progress");
    mocks.context.loadPaper = vi.fn().mockRejectedValue(new CandidatePaperError("exam_closed", 409));
    mocks.context.refreshState = vi.fn().mockResolvedValue(state("in_progress", "closed"));
    render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "Time is up" })).toBeTruthy();
    expect(screen.queryByText("Choose")).toBeNull();
    expect(screen.getByText("Answers are not saved yet (Phase 2 batch 3)")).toBeTruthy();
  });

  it("loads the paper again when context has no in-memory paper", async () => {
    const value = paper();
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    await waitFor(() => expect(mocks.context.loadPaper).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Question 1" })).toBeTruthy();
  });
});
