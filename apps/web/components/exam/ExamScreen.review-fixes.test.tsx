// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitInputSchema } from "@/lib/candidate-answer-schemas";
import type { PaperBody, StateBody } from "@/lib/candidate-types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  context: {} as Record<string, unknown>,
  autosave: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/useExamStatePoll", () => ({ useExamStatePoll: vi.fn() }));
vi.mock("@/hooks/useAutosave", () => ({ useAutosave: () => mocks.autosave }));
vi.mock("@/lib/time", () => ({ refineServerClock: vi.fn(), useServerClock: () => () => Date.parse("2026-10-04T10:00:00.000Z") }));
vi.mock("@/components/candidate/CandidateContext", () => ({
  CandidatePaperError: class CandidatePaperError extends Error {},
  useCandidate: () => mocks.context,
  Notice: ({ children }: { children: React.ReactNode }) => <div role="status">{children}</div>,
  CandidateErrorScreen: ({ title, body }: { title: string; body: string }) => <main><h1>{title}</h1><p>{body}</p></main>,
}));

import { ExamScreen } from "./ExamScreen";

function state(expired = false): StateBody {
  return {
    server_time: "2026-10-04T10:00:00.000Z",
    phase: "live",
    exam: { id: "e", title: "Synthetic exam", status: "live", navigation_mode: "sequential", scheduled_start_at: null, started_at: "2026-10-04T09:00:00.000Z", ends_at: "2026-10-04T11:00:00.000Z", force_ended: false, question_count: 3 },
    attempt: { id: "a", status: "in_progress", current_position: 0, extra_minutes: 0, deadline: expired ? "2026-10-04T10:00:00.000Z" : "2026-10-04T11:00:00.000Z", submit_reason: null },
    announcements: [],
  };
}

function question(id: string, position: number): PaperBody["questions"][number] {
  return { id, position, type: "mcq", body_html: `<p>Question ${position + 1}</p>`, image: null, marks: 1, options: [{ id: `${id}-a`, text_html: "<p>One</p>" }, { id: `${id}-b`, text_html: "<p>Two</p>" }] };
}

function paper(total = 1): PaperBody {
  return { server_time: "2026-10-04T10:00:00.000Z", navigation_mode: "sequential", total_questions: total, current_position: 0, questions: [question("q1", 0)], answers: {} };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function setAutosave(pending: unknown[] = []) {
  mocks.autosave = {
    answers: {
      q1: { answer_text: null, selected_option_id: "q1-a", flagged: false },
      q2: { answer_text: null, selected_option_id: "q2-a", flagged: false },
    },
    ready: true,
    durable: true,
    currentState: { kind: "saved", durable: true, savedAt: null },
    updateAnswer: vi.fn(),
    flushQuestion: vi.fn().mockResolvedValue(undefined),
    flushAll: vi.fn().mockResolvedValue(pending),
    pendingAnswers: vi.fn(() => pending),
    answerInput: vi.fn((id: string) => ({ question_id: id, answer_text: null, selected_option_id: `${id}-a`, flagged: false, revision: 1 })),
    confirmDirectSave: vi.fn().mockResolvedValue(undefined),
    clearDrafts: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  setAutosave();
  const value = paper();
  mocks.context = {
    state: state(),
    me: { candidate: { full_name: "Candidate", mer_code: "TEST" } },
    paper: value,
    loadMe: vi.fn(),
    loadPaper: vi.fn().mockResolvedValue(value),
    refreshState: vi.fn().mockResolvedValue(state()),
  };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ExamScreen Commit C review fixes", () => {
  it("releases the submit action lock when flushing drafts rejects", async () => {
    const pending = [{
      question_id: "00000000-0000-4000-8000-000000000011",
      answer_text: "Synthetic pending answer",
      selected_option_id: null,
      flagged: false,
      revision: 2,
    }];
    const flushAll = vi.fn().mockRejectedValueOnce(new Error("storage failed")).mockResolvedValueOnce(pending);
    mocks.autosave.flushAll = flushAll;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body));
      const parsed = submitInputSchema.safeParse(requestBody);
      if (!parsed.success) return json({ error: { code: "validation_failed", message: "Invalid request" } }, 400);
      return json({ submitted: true, already_submitted: false, save_results: [], server_time: "2026-10-04T10:00:00Z" });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ExamScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Submit exam" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Submit exam" })[1]!);
    expect(await screen.findByText("We couldn't submit yet. Your answers are saved. Try again.")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Submit exam" })[1]!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/done"));
    expect(flushAll).toHaveBeenCalledTimes(2);
    const requestBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(submitInputSchema.parse(requestBody)).toEqual(requestBody);
    expect(Object.keys(requestBody).sort()).toEqual(["pending_answers", "reason"]);
    expect(requestBody).toMatchObject({ reason: "manual", pending_answers: pending });
  });

  it("retries sequential Next after 1, 2, 4, 8 and 10 seconds and resets after success", async () => {
    vi.useFakeTimers();
    const value = paper(3);
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => json({ result: "advanced", position: 1, total_questions: 3, question: question("q2", 1), answer: null, server_time: "2026-10-04T10:00:01Z" }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => json({ result: "advanced", position: 2, total_questions: 3, question: question("q3", 2), answer: null, server_time: "2026-10-04T10:00:02Z" }));
    vi.stubGlobal("fetch", fetcher);
    render(<ExamScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [1_000, 2_000, 4_000, 8_000, 10_000].entries()) {
      await act(() => vi.advanceTimersByTimeAsync(delay - 1));
      expect(fetcher).toHaveBeenCalledTimes(index + 1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(fetcher).toHaveBeenCalledTimes(index + 2);
    }
    expect(screen.getByRole("heading", { name: "Question 2" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(7);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetcher).toHaveBeenCalledTimes(7);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(screen.getByRole("heading", { name: "Question 3" })).toBeTruthy();
  });

  it.each([
    [[], "Time is up. Keep this page open and tell the exam team."],
    [[{ question_id: "q1" }], "Time is up. Some answers could not be sent. Keep this page open and tell the exam team."],
  ])("uses the accurate collection-closed notice for pending drafts", async (pending, expected) => {
    setAutosave(pending);
    mocks.context.state = state(true);
    vi.stubGlobal("fetch", vi.fn(() => json({ error: { code: "collection_closed", message: "Closed" } }, 409)));
    render(<ExamScreen />);

    expect(await screen.findByText(expected)).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalledWith("/done");
  });
});
