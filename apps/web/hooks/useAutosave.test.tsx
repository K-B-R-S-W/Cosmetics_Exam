// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedAnswer } from "@/lib/candidate-types";
import { createAnswerDraftStore, type StoredAnswerDraft } from "@/lib/indexeddb";
import { mergeReconnectDraft, useAutosave } from "./useAutosave";

const attemptId = "00000000-0000-4000-8000-000000000003";
const questionId = "00000000-0000-4000-8000-000000000011";
const nextQuestionId = "00000000-0000-4000-8000-000000000012";

function dirtyDraft(id = questionId): StoredAnswerDraft {
  return {
    attempt_id: attemptId,
    question_id: id,
    answer_text: `Local ${id}`,
    selected_option_id: null,
    flagged: true,
    revision: 4,
    confirmed_revision: 3,
    dirty: true,
    saved_at: null,
    updated_at: 1,
  };
}

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function options(fetcher: typeof fetch, serverAnswers: Record<string, SavedAnswer> = {}) {
  return {
    attemptId,
    questionIds: [questionId],
    serverAnswers,
    currentQuestionId: questionId,
    store: createAnswerDraftStore(undefined),
    fetcher,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("reconnect merge", () => {
  const server: SavedAnswer = { answer_text: "Server", selected_option_id: null, flagged: false, revision: 5, saved_at: "2026-10-04T10:00:00Z" };
  const local: StoredAnswerDraft = { attempt_id: attemptId, question_id: questionId, answer_text: "Local", selected_option_id: null, flagged: true, revision: 6, confirmed_revision: 5, dirty: true, saved_at: null, updated_at: 1 };

  it("keeps a dirty local draft only when the server is at this device's confirmed revision", () => {
    expect(mergeReconnectDraft(attemptId, questionId, server, local)).toMatchObject({ answer_text: "Local", dirty: true });
  });

  it("discards the local draft when another device moved the server ahead", () => {
    expect(mergeReconnectDraft(attemptId, questionId, { ...server, revision: 6 }, local)).toMatchObject({ answer_text: "Server", revision: 6, dirty: false });
  });
});

describe("useAutosave", () => {
  it("debounces for one second and never shows Saved before the latest revision is confirmed", async () => {
    let resolveRequest!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; })) as unknown as typeof fetch;
    const hookOptions = options(fetcher);
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "Synthetic", selected_option_id: null, flagged: false }));
    expect(result.current.currentState.kind).toBe("waiting");
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(fetcher).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.currentState.kind).toBe("saving");
    expect(result.current.currentState.kind).not.toBe("saved");
    await act(async () => resolveRequest(await response({ result: "saved", server_time: "2026-10-04T08:32:00Z" })));
    await flush();
    expect(result.current.currentState.kind).toBe("saved");
  });

  it("coalesces changes behind one in-flight request and sends the latest value next", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<Response>((resolve) => resolvers.push((value) => { active -= 1; resolve(value); }));
    }) as unknown as typeof fetch;
    const hookOptions = options(fetcher);
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "First", selected_option_id: null, flagged: false }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => result.current.updateAnswer(questionId, { answer_text: "Latest", selected_option_id: null, flagged: false }, true));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => resolvers.shift()!(await response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(vi.mocked(fetcher).mock.calls[1]?.[1]?.body));
    expect(second.answer_text).toBe("Latest");
    expect(peak).toBe(1);
    await act(async () => resolvers.shift()!(await response({ result: "saved", server_time: "2026-10-04T10:00:01Z" })));
  });

  it("recovers stale revisions and retries the latest local value", async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ result: "stale_revision", server_revision: 9, server_time: "2026-10-04T10:00:00Z" }))
      .mockImplementationOnce(() => response({ result: "saved", server_time: "2026-10-04T10:00:01Z" })) as unknown as typeof fetch;
    const hookOptions = options(fetcher);
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "Latest", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[1]?.[1]?.body)).revision).toBe(10);
    await flush();
    expect(result.current.currentState.kind).toBe("saved");
  });

  it("retries stale_revision only once for the same local edit", async () => {
    const onPermanentError = vi.fn();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ result: "stale_revision", server_revision: 9, server_time: "2026-10-04T10:00:00Z" }))
      .mockImplementationOnce(() => response({ result: "stale_revision", server_revision: 10, server_time: "2026-10-04T10:00:01Z" })) as unknown as typeof fetch;
    const hookOptions = { ...options(fetcher), onPermanentError };
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "Latest", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onPermanentError).toHaveBeenCalledWith("stale_revision");
    expect(result.current.currentState.kind).toBe("failed");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an unexpected 4xx dirty, shows failed, and retries only after the value changes", async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => response({ error: { code: "payload_too_large", message: "Too large", details: null } }, 413))
      .mockImplementationOnce(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const hookOptions = options(fetcher);
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "First", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(result.current.currentState.kind).toBe("failed");
    expect(result.current.pendingAnswers()).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => result.current.updateAnswer(questionId, { answer_text: "Changed", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.currentState.kind).toBe("saved");
  });

  it("drops wrong_position, asks for a state resync, and does not show failed", async () => {
    const onWrongPosition = vi.fn();
    const fetcher = vi.fn(() => response({ error: { code: "wrong_position", message: "Wrong", details: null } }, 409)) as unknown as typeof fetch;
    const hookOptions = { ...options(fetcher), onWrongPosition };
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "Moved", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(onWrongPosition).toHaveBeenCalledOnce();
    expect(result.current.pendingAnswers()).toEqual([]);
    expect(result.current.currentState.kind).not.toBe("failed");
  });

  it("restores a dirty IndexedDB draft under React StrictMode and gates input until ready", async () => {
    const store = createAnswerDraftStore(undefined);
    await store.put({
      attempt_id: attemptId,
      question_id: questionId,
      answer_text: "Restored",
      selected_option_id: null,
      flagged: true,
      revision: 4,
      confirmed_revision: 3,
      dirty: true,
      saved_at: null,
      updated_at: 1,
    });
    let release!: (rows: StoredAnswerDraft[]) => void;
    const delayedStore = {
      ...store,
      loadAttempt: vi.fn(() => new Promise<StoredAnswerDraft[]>((resolve) => { release = resolve; })),
    };
    const fetcher = vi.fn(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const server: SavedAnswer = { answer_text: "Server", selected_option_id: null, flagged: false, revision: 3, saved_at: "2026-10-04T09:00:00Z" };
    const hookOptions = { ...options(fetcher, { [questionId]: server }), store: delayedStore };
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useAutosave(hookOptions), { wrapper });
    expect(result.current.ready).toBe(false);
    await act(async () => release(await store.loadAttempt(attemptId)));
    await flush();
    if (!result.current.ready) {
      await act(async () => release(await store.loadAttempt(attemptId)));
      await flush();
    }
    expect(result.current.ready).toBe(true);
    expect(result.current.answers[questionId]).toMatchObject({ answer_text: "Restored", flagged: true });
  });

  it("retries network and 5xx failures but drops permanent failures", async () => {
    const retrying = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const firstOptions = options(retrying);
    const first = renderHook(() => useAutosave(firstOptions));
    await flush();
    act(() => first.result.current.updateAnswer(questionId, { answer_text: "Retry", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(retrying).toHaveBeenCalledTimes(1);
    expect(first.result.current.currentState.kind).toBe("offline");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await flush();
    expect(retrying).toHaveBeenCalledTimes(2);
    first.unmount();

    for (const code of ["wrong_position", "not_in_paper", "bad_option"]) {
      const permanent = vi.fn(() => response({ error: { code, message: "Permanent", details: null } }, code === "wrong_position" ? 409 : 400)) as unknown as typeof fetch;
      const secondOptions = options(permanent);
      const second = renderHook(() => useAutosave(secondOptions));
      await flush();
      act(() => second.result.current.updateAnswer(questionId, { answer_text: null, selected_option_id: "00000000-0000-4000-8000-000000000099", flagged: false }, true));
      await flush();
      expect(permanent).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(permanent).toHaveBeenCalledTimes(1);
      expect(second.result.current.pendingAnswers()).toEqual([]);
      second.unmount();
    }
  });

  it("retries 5xx responses and the ten-second periodic flush sends remaining dirty work", async () => {
    const retrying = vi.fn()
      .mockImplementationOnce(() => response({ error: { code: "internal_error", message: "Try again", details: null } }, 503))
      .mockImplementationOnce(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const retryOptions = options(retrying);
    const first = renderHook(() => useAutosave(retryOptions));
    await flush();
    act(() => first.result.current.updateAnswer(questionId, { answer_text: "Retry", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(first.result.current.currentState.kind).toBe("retrying");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await flush();
    expect(retrying).toHaveBeenCalledTimes(2);
    first.unmount();

    const periodic = vi.fn(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const periodicOptions = options(periodic);
    const second = renderHook(({ enabled }) => useAutosave({ ...periodicOptions, enabled }), { initialProps: { enabled: false } });
    await flush();
    act(() => second.result.current.updateAnswer(questionId, { answer_text: "Periodic", selected_option_id: null, flagged: false }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(periodic).not.toHaveBeenCalled();
    second.rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(9000));
    await flush();
    expect(periodic).toHaveBeenCalledTimes(1);
  });

  it("persists and sends a cleared blank answer before Next can flush", async () => {
    const fetcher = vi.fn(() => response({ result: "saved", server_time: "2026-10-04T10:00:00Z" })) as unknown as typeof fetch;
    const saved: SavedAnswer = { answer_text: "Existing", selected_option_id: null, flagged: false, revision: 3, saved_at: "2026-10-04T09:00:00Z" };
    const hookOptions = options(fetcher, { [questionId]: saved });
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "", selected_option_id: null, flagged: false }));
    await act(() => result.current.flushQuestion(questionId));
    expect(JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))).toMatchObject({ answer_text: "", revision: 4 });
  });

  it("uses truthful memory-only offline state without calling the server", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const fetcher = vi.fn() as unknown as typeof fetch;
    const hookOptions = options(fetcher);
    const { result } = renderHook(() => useAutosave(hookOptions));
    await flush();
    act(() => result.current.updateAnswer(questionId, { answer_text: "Offline", selected_option_id: null, flagged: false }, true));
    await flush();
    expect(result.current.currentState.kind).toBe("offline");
    expect(result.current.currentState.durable).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("collects 100 dirty answers for the final pending_answers payload", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `question-${index}`);
    const fetcher = vi.fn() as unknown as typeof fetch;
    const store = createAnswerDraftStore(undefined);
    const { result } = renderHook(() => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: {},
      currentQuestionId: ids[0]!,
      enabled: false,
      store,
      fetcher,
    }));
    await flush();
    act(() => {
      for (const id of ids) result.current.updateAnswer(id, { answer_text: `Answer ${id}`, selected_option_id: null, flagged: false });
    });
    await flush();
    expect(result.current.pendingAnswers()).toHaveLength(100);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("adds a newly returned sequential question without resetting the attempt", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const store = createAnswerDraftStore(undefined);
    const hook = renderHook(({ ids }) => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: {},
      currentQuestionId: ids.at(-1) ?? null,
      enabled: false,
      store,
      fetcher,
    }), { initialProps: { ids: [questionId] } });
    await flush();
    hook.rerender({ ids: ["00000000-0000-4000-8000-000000000012"] });
    await flush();
    expect(hook.result.current.answers["00000000-0000-4000-8000-000000000012"]).toEqual({ answer_text: null, selected_option_id: null, flagged: false });
  });

  it("restores a dirty IndexedDB draft when the paper question arrives after initialization", async () => {
    vi.useRealTimers();
    const store = createAnswerDraftStore(new IDBFactory());
    await store.put(dirtyDraft());
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const server: SavedAnswer = { answer_text: "Server", selected_option_id: null, flagged: false, revision: 3, saved_at: "2026-10-04T09:00:00Z" };
    const hook = renderHook(({ ids, answers }) => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: answers,
      currentQuestionId: ids[0] ?? null,
      store,
      fetcher,
    }), { initialProps: { ids: [] as string[], answers: {} as Record<string, SavedAnswer> } });
    await flush();

    hook.rerender({ ids: [questionId], answers: { [questionId]: server } });
    await flush();

    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.answers[questionId]).toMatchObject({ answer_text: `Local ${questionId}`, flagged: true });
    expect(hook.result.current.pendingAnswers()).toHaveLength(1);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect((await store.loadAttempt(attemptId)).find((row) => row.question_id === questionId)).toMatchObject({ answer_text: `Local ${questionId}`, dirty: true });
  });

  it("uses the newer server answer when a late paper arrives after another device saved", async () => {
    vi.useRealTimers();
    const store = createAnswerDraftStore(new IDBFactory());
    await store.put(dirtyDraft());
    const fetcher = vi.fn() as unknown as typeof fetch;
    const server: SavedAnswer = { answer_text: "Newer server", selected_option_id: null, flagged: false, revision: 4, saved_at: "2026-10-04T09:00:00Z" };
    const hook = renderHook(({ ids, answers }) => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: answers,
      currentQuestionId: ids[0] ?? null,
      store,
      fetcher,
    }), { initialProps: { ids: [] as string[], answers: {} as Record<string, SavedAnswer> } });
    await flush();

    hook.rerender({ ids: [questionId], answers: { [questionId]: server } });
    await flush();

    await waitFor(() => expect(hook.result.current.answers[questionId]).toMatchObject({ answer_text: "Newer server", flagged: false }));
    expect(hook.result.current.pendingAnswers()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await store.loadAttempt(attemptId)).find((row) => row.question_id === questionId)).toMatchObject({ answer_text: "Newer server", dirty: false });
  });

  it("restores a late dirty IndexedDB draft under React StrictMode", async () => {
    vi.useRealTimers();
    const store = createAnswerDraftStore(new IDBFactory());
    await store.put(dirtyDraft());
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const hook = renderHook(({ ids }) => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: { [questionId]: { answer_text: "Server", selected_option_id: null, flagged: false, revision: 3, saved_at: "2026-10-04T09:00:00Z" } },
      currentQuestionId: ids[0] ?? null,
      store,
      fetcher,
    }), { initialProps: { ids: [] as string[] }, wrapper });
    await flush();

    hook.rerender({ ids: [questionId] });
    await flush();

    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.answers[questionId]?.answer_text).toBe(`Local ${questionId}`);
    expect(hook.result.current.pendingAnswers()).toHaveLength(1);
  });

  it("restores a stored draft when a new sequential question arrives later", async () => {
    vi.useRealTimers();
    const store = createAnswerDraftStore(new IDBFactory());
    await store.put({ ...dirtyDraft(nextQuestionId), revision: 1, confirmed_revision: 0 });
    expect(await store.loadAttempt(attemptId)).toEqual([expect.objectContaining({ question_id: nextQuestionId, dirty: true })]);
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const hook = renderHook(({ ids }) => useAutosave({
      attemptId,
      questionIds: ids,
      serverAnswers: {},
      currentQuestionId: ids[0] ?? null,
      store,
      fetcher,
    }), { initialProps: { ids: [questionId] } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    hook.rerender({ ids: [nextQuestionId] });
    await flush();

    await waitFor(() => expect(hook.result.current.answers[nextQuestionId]?.answer_text).toBe(`Local ${nextQuestionId}`));
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.pendingAnswers()).toEqual([expect.objectContaining({ question_id: nextQuestionId })]);
  });
});
