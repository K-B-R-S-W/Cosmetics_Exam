// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerInputSchema, nextInputSchema } from "@/lib/candidate-answer-schemas";
import type { PaperBody, StateBody } from "@/lib/candidate-types";
import { getAnswerDraftStore } from "@/lib/indexeddb";

const mocks = vi.hoisted(() => ({ push: vi.fn(), context: {} as Record<string, unknown>, proctoring: vi.fn() }));
const CONTRACT_QUESTION_ONE = "00000000-0000-4000-8000-000000000011";
const CONTRACT_QUESTION_TWO = "00000000-0000-4000-8000-000000000012";
const CONTRACT_OPTION_ONE = "00000000-0000-4000-8000-000000000021";
const CONTRACT_OPTION_TWO = "00000000-0000-4000-8000-000000000022";
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("@/hooks/useProctoring", () => ({ useProctoring: (options: unknown) => {
  mocks.proctoring(options);
  return { fullscreenLost: false, flush: vi.fn().mockResolvedValue(undefined), sendInstant: vi.fn(), pendingCount: () => 0 };
} }));
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

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.proctoring.mockReset();
  const value = paper();
  mocks.context = { state: state(), me: { candidate: { full_name: "Candidate", mer_code: "TEST" } }, paper: value, loadMe: vi.fn(), loadPaper: vi.fn().mockResolvedValue(value), refreshState: vi.fn().mockResolvedValue(state()), heartbeatNow: vi.fn().mockResolvedValue(state()), hasExamHandoff: vi.fn().mockReturnValue(false) };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/answers") return json({ result: "saved", server_time: "2026-10-04T10:00:00.000Z" });
    if (url === "/api/exam/submit") return json({ submitted: true, already_submitted: false, save_results: [], server_time: "2026-10-04T10:00:00.000Z" });
    throw new Error(`Unexpected request ${url}`);
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ExamScreen", () => {
  it("marks a fresh in-progress page load as resumed", () => {
    render(<ExamScreen />);
    expect(mocks.proctoring).toHaveBeenLastCalledWith(expect.objectContaining({ resumed: true, inProgress: true }));
  });

  it("claims a heartbeat announcement and shows its toast text", async () => {
    mocks.context.state = { ...state(), announcements: [{ id: "00000000-0000-4000-8000-000000000099", sent_at: "2026-10-04T10:00:00.000Z" }] };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/claim")) return json({ display: true, announcement: { id: "00000000-0000-4000-8000-000000000099", message: "Bring your answers to the front desk.", sent_at: "2026-10-04T10:00:00.000Z" } });
      if (url === "/api/answers") return json({ result: "saved", server_time: "2026-10-04T10:00:00.000Z" });
      throw new Error(`Unexpected request ${url}`);
    }));
    render(<ExamScreen />);
    expect(await screen.findByText('The exam team says: "Bring your answers to the front desk."')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/exam/announcements/00000000-0000-4000-8000-000000000099/claim", expect.anything());
  });

  it("does not mark a waiting-room handoff as resumed", () => {
    mocks.context.hasExamHandoff = vi.fn().mockReturnValue(true);
    render(<ExamScreen />);
    expect(mocks.proctoring).toHaveBeenLastCalledWith(expect.objectContaining({ resumed: false, inProgress: true }));
  });

  it("captures a late join as non-resumed before the paper changes status", async () => {
    const value = paper();
    mocks.context.state = state("acknowledged");
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    const view = render(<ExamScreen />);
    await waitFor(() => expect(mocks.context.loadPaper).toHaveBeenCalled());
    mocks.context.state = state("in_progress");
    mocks.context.paper = value;
    view.rerender(<ExamScreen />);
    expect(mocks.proctoring).toHaveBeenLastCalledWith(expect.objectContaining({ resumed: false, inProgress: true }));
  });

  it("keeps the initial resumed decision across state refreshes and rerenders", () => {
    const view = render(<ExamScreen />);
    mocks.context.hasExamHandoff = vi.fn().mockReturnValue(true);
    mocks.context.state = { ...state(), server_time: "2026-10-04T10:00:10.000Z" };
    view.rerender(<ExamScreen />);
    expect(mocks.proctoring).toHaveBeenLastCalledWith(expect.objectContaining({ resumed: true, inProgress: true }));
  });

  it("saves free-mode answers, navigates locally, and ignores current_position", async () => {
    const value = { ...paper(), current_position: 99 };
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    expect(screen.getByText("Candidate · TEST")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Question 1" })).toBeTruthy();
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Question 2" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Synthetic answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(screen.getByRole("heading", { name: "Review your answers" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit exam" }) as HTMLButtonElement).disabled).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/answers", expect.anything());
  });

  it("shows only the current sequential question and gates Next until local restore is ready", async () => {
    const value = paper("sequential");
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    const next = screen.getByRole("button", { name: "Next question" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await waitFor(() => expect(next.disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  });

  it("confirms a cleared answer through /api/answers before sequential Next", async () => {
    const value = paper("sequential");
    value.questions = [{ id: CONTRACT_QUESTION_ONE, position: 0, type: "written", body_html: "<p>Explain</p>", image: null, marks: 1 }];
    value.answers = { [CONTRACT_QUESTION_ONE]: { answer_text: "Saved text", selected_option_id: null, flagged: false, revision: 2, saved_at: "2026-10-04T09:00:00Z" } };
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const requestBody = JSON.parse(String(init?.body));
      if (url === "/api/answers") {
        const parsed = answerInputSchema.safeParse(requestBody);
        return parsed.success
          ? json({ result: "saved", server_time: "2026-10-04T10:00:00Z" })
          : json({ error: { code: "validation_failed", message: "Invalid request" } }, 400);
      }
      if (url === "/api/exam/next") {
        const parsed = nextInputSchema.safeParse(requestBody);
        return parsed.success
          ? json({ result: "advanced", position: 1, total_questions: 2, question: { id: CONTRACT_QUESTION_TWO, position: 1, type: "written", body_html: "<p>Second</p>", image: null, marks: 1 }, answer: null, server_time: "2026-10-04T10:00:01Z" })
          : json({ error: { code: "validation_failed", message: "Invalid request" } }, 400);
      }
      throw new Error(url);
    }));
    render(<ExamScreen />);
    const answer = await screen.findByLabelText("Your answer") as HTMLTextAreaElement;
    await waitFor(() => expect(answer.disabled).toBe(false));
    fireEvent.change(answer, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByRole("dialog", { name: "Move on without an answer?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue without an answer" }));
    expect(await screen.findByRole("heading", { name: "Question 2" })).toBeTruthy();
    expect(calls.slice(0, 2)).toEqual(["/api/answers", "/api/exam/next"]);
    const answerCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/answers");
    const answerBody = JSON.parse(String(answerCall?.[1]?.body));
    expect(answerInputSchema.parse(answerBody)).toEqual(answerBody);
    expect(answerBody).toMatchObject({ question_id: CONTRACT_QUESTION_ONE, answer_text: "" });
    const nextCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/exam/next");
    const nextBody = JSON.parse(String(nextCall?.[1]?.body));
    expect(nextInputSchema.parse(nextBody)).toEqual(nextBody);
    expect(Object.keys(nextBody).sort()).toEqual(["answer_text", "expected_position", "question_id", "revision", "selected_option_id"]);
    expect(nextBody).toMatchObject({ question_id: CONTRACT_QUESTION_ONE, answer_text: "", expected_position: 0 });
    expect(mocks.context.heartbeatNow).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Question 2" })).toBeTruthy();
  });

  it.each(["advanced", "already_advanced", "invalid_state"] as const)("sends a strict-schema Next body and handles %s", async (result) => {
    const value: PaperBody = {
      ...paper("sequential"),
      questions: [{
        id: CONTRACT_QUESTION_ONE,
        position: 0,
        type: "mcq",
        body_html: "<p>Choose</p>",
        image: null,
        marks: 1,
        options: [
          { id: CONTRACT_OPTION_ONE, text_html: "<p>One</p>" },
          { id: CONTRACT_OPTION_TWO, text_html: "<p>Two</p>" },
        ],
      }],
      answers: {},
    };
    const nextPaper: PaperBody = {
      ...value,
      current_position: 1,
      questions: [{ id: CONTRACT_QUESTION_TWO, position: 1, type: "written", body_html: "<p>Second</p>", image: null, marks: 1 }],
    };
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(nextPaper);
    const captured: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const requestBody = JSON.parse(String(init?.body));
      if (url === "/api/answers") {
        const parsed = answerInputSchema.safeParse(requestBody);
        return parsed.success
          ? json({ result: "saved", server_time: "2026-10-04T10:00:00Z" })
          : json({ error: { code: "validation_failed", message: "Invalid request" } }, 400);
      }
      if (url === "/api/exam/next") {
        captured.push(requestBody);
        const parsed = nextInputSchema.safeParse(requestBody);
        if (!parsed.success) return json({ error: { code: "validation_failed", message: "Invalid request" } }, 400);
        if (result === "invalid_state") return json({ error: { code: "invalid_state", message: "Reload" } }, 409);
        return json({ result, position: 1, total_questions: 2, question: nextPaper.questions[0], answer: null, server_time: "2026-10-04T10:00:01Z" });
      }
      throw new Error(url);
    }));

    render(<ExamScreen />);
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    expect(await screen.findByRole("heading", { name: "Question 2" })).toBeTruthy();
    expect(captured).toHaveLength(1);
    expect(nextInputSchema.parse(captured[0])).toEqual(captured[0]);
    expect(Object.keys(captured[0] as object).sort()).toEqual(["answer_text", "expected_position", "question_id", "revision", "selected_option_id"]);
    expect(captured[0]).toMatchObject({
      question_id: CONTRACT_QUESTION_ONE,
      selected_option_id: CONTRACT_OPTION_ONE,
      expected_position: 0,
    });
  });

  it("uses the Section 2B submit dialog copy and includes dirty failed drafts", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/answers") return json({ error: { code: "payload_too_large", message: "Too large" } }, 413);
      if (url === "/api/exam/submit") return json({ submitted: true, already_submitted: false, save_results: [{ question_id: "q1", result: "validation_failed" }], server_time: "2026-10-04T10:00:00Z" });
      throw new Error(`${url} ${String(init?.body)}`);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ExamScreen />);
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await waitFor(() => expect(screen.getByTestId("save-indicator").textContent).toContain("Could not save"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByLabelText("Your answer"), { target: { value: "Answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit exam" }));
    const dialog = screen.getByRole("dialog", { name: "Submit your exam?" });
    expect(dialog.textContent).toContain("You can't change your answers after you submit.");
    fireEvent.click(screen.getAllByRole("button", { name: "Submit exam" })[1]!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/done"));
    const submitCall = fetcher.mock.calls.find(([url]) => String(url) === "/api/exam/submit");
    const submitted = JSON.parse(String(submitCall?.[1]?.body));
    expect(submitted.pending_answers).toEqual(expect.arrayContaining([expect.objectContaining({ question_id: "q1" })]));
  });

  it("uses keep-window-open submit failure copy when durable storage is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/exam/submit"
      ? Promise.reject(new TypeError("offline"))
      : json({ result: "saved", server_time: "2026-10-04T10:00:00Z" })));
    render(<ExamScreen />);
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Question 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit exam" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Submit exam" })[1]!);
    expect(await screen.findByText("We couldn't submit yet. Keep this window open and try again.")).toBeTruthy();
  });

  it("locks at the deadline and submits with the auto hint", async () => {
    const expired = { ...state(), attempt: { ...state().attempt, deadline: "2026-10-04T10:00:00.000Z" } };
    mocks.context.state = expired;
    mocks.context.refreshState = vi.fn().mockResolvedValue({ ...expired, phase: "submitted", attempt: { ...expired.attempt, status: "submitted", submit_reason: "auto" } });
    render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "Time is up" })).toBeTruthy();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/done"));
    const submitCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/exam/submit");
    expect(JSON.parse(String(submitCall?.[1]?.body))).toMatchObject({ reason: "auto" });
  });

  it("shows the terminal notice when the collection window is closed", async () => {
    const expired = { ...state(), attempt: { ...state().attempt, deadline: "2026-10-04T10:00:00.000Z" } };
    mocks.context.state = expired;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/exam/submit"
      ? json({ error: { code: "collection_closed", message: "Closed" } }, 409)
      : json({ result: "saved", server_time: "2026-10-04T10:00:00Z" })));
    render(<ExamScreen />);
    expect(await screen.findByText("Time is up. Keep this page open and tell the exam team.")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalledWith("/done");
  });

  it("unlocks after fresh state grants extra time", async () => {
    const expired = { ...state(), attempt: { ...state().attempt, deadline: "2026-10-04T10:00:00.000Z" } };
    mocks.context.state = expired;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const view = render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "Time is up" })).toBeTruthy();
    mocks.context.state = { ...expired, phase: "live", attempt: { ...expired.attempt, extra_minutes: 15, deadline: "2026-10-04T10:15:00.000Z" } };
    view.rerender(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "Question 1" })).toBeTruthy();
  });

  it("locks on a force-end and lets the server derive forced from an auto hint", async () => {
    const forced = { ...state("in_progress", "closed"), exam: { ...state().exam, status: "live" as const, force_ended: true } };
    mocks.context.state = forced;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "The exam has ended" })).toBeTruthy();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/exam/submit", expect.anything()));
    const submitCall = fetcher.mock.calls.find(([url]) => String(url) === "/api/exam/submit");
    expect(JSON.parse(String(submitCall?.[1]?.body))).toMatchObject({ reason: "auto" });
  });

  it("locks when sequential Next returns exam_closed", async () => {
    const value = paper("sequential");
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/answers") return json({ result: "saved", server_time: "2026-10-04T10:00:00Z" });
      if (url === "/api/exam/next") return json({ error: { code: "exam_closed", message: "Closed" } }, 409);
      if (url === "/api/exam/submit") return new Promise<Response>(() => undefined);
      throw new Error(url);
    }));
    render(<ExamScreen />);
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(await screen.findByRole("heading", { name: "Time is up" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Question 2" })).toBeNull();
  });

  it("guards a sequential double-tap and accepts an already_advanced lost-reply result", async () => {
    const value = paper("sequential");
    mocks.context.paper = value;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    let resolveNext!: (response: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/answers") return json({ result: "saved", server_time: "2026-10-04T10:00:00Z" });
      if (url === "/api/exam/next") return new Promise<Response>((resolve) => { resolveNext = resolve; });
      throw new Error(url);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<ExamScreen />);
    await waitFor(() => expect((screen.getAllByRole("radio")[0] as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/answers", expect.anything()));
    const next = screen.getByRole("button", { name: "Next question" });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/exam/next")).toHaveLength(1);
    resolveNext(await json({ result: "already_advanced", position: 1, total_questions: 2, question: { id: "q2", position: 1, type: "written", body_html: "<p>Second</p>", image: null, marks: 1 }, answer: null, server_time: "2026-10-04T10:00:01Z" }));
    expect(await screen.findByRole("heading", { name: "Question 2" })).toBeTruthy();
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
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    mocks.context.paper = null;
    mocks.context.state = state("in_progress");
    mocks.context.loadPaper = vi.fn().mockRejectedValue(new CandidatePaperError("exam_closed", 409));
    mocks.context.refreshState = vi.fn().mockResolvedValue(state("in_progress", "closed"));
    render(<ExamScreen />);
    expect(await screen.findByRole("heading", { name: "Time is up" })).toBeTruthy();
    expect(screen.queryByText("Choose")).toBeNull();
    expect(screen.getByTestId("save-indicator").textContent).toContain("Saved");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.context.loadPaper).toHaveBeenCalledTimes(1);
  });

  it("sends exam_not_live with waiting state back to the waiting room", async () => {
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn().mockRejectedValue(new CandidatePaperError("exam_not_live", 409));
    mocks.context.refreshState = vi.fn().mockResolvedValue({
      ...state("acknowledged"),
      phase: "waiting",
      exam: { ...state().exam, status: "scheduled" },
    });
    render(<ExamScreen />);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/waiting"));
  });

  it("shows the long-delay notice after six transient failures", async () => {
    vi.useFakeTimers();
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn().mockRejectedValue(new Error("deterministic server failure"));
    render(<ExamScreen />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    for (let failure = 1; failure < 6; failure += 1) {
      await act(() => vi.advanceTimersByTimeAsync(5000));
    }
    expect(mocks.context.loadPaper).toHaveBeenCalledTimes(6);
    expect(screen.getByText("This is taking longer than expected. Tell the exam team if this continues.")).toBeTruthy();
  });

  it("loads the paper again when context has no in-memory paper", async () => {
    const value = paper();
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn().mockResolvedValue(value);
    render(<ExamScreen />);
    await waitFor(() => expect(mocks.context.loadPaper).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Question 1" })).toBeTruthy();
  });

  it("restores a dirty draft when the paper arrives after the exam screen mounts", async () => {
    const store = getAnswerDraftStore();
    await store.clearAttempt("a");
    await store.put({
      attempt_id: "a",
      question_id: "q1",
      answer_text: "Restored after late paper load",
      selected_option_id: null,
      flagged: false,
      revision: 1,
      confirmed_revision: 0,
      dirty: true,
      saved_at: null,
      updated_at: 1,
    });
    const value = paper("sequential");
    value.total_questions = 1;
    value.questions = [{ id: "q1", position: 0, type: "written", body_html: "<p>Explain</p>", image: null, marks: 1 }];
    let resolvePaper!: (value: PaperBody) => void;
    mocks.context.paper = null;
    mocks.context.loadPaper = vi.fn(() => new Promise<PaperBody>((resolve) => { resolvePaper = resolve; }));

    render(<ExamScreen />);
    await waitFor(() => expect(mocks.context.loadPaper).toHaveBeenCalledOnce());
    await act(async () => resolvePaper(value));

    const answer = await screen.findByLabelText("Your answer") as HTMLTextAreaElement;
    expect(answer.value).toBe("Restored after late paper load");
    await store.clearAttempt("a");
  });
});
