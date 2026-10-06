// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViolationRealtime } from "./useViolationRealtime";

const realtime = vi.hoisted(() => {
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>();
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  const unsubscribeAuth = vi.fn();
  const client = {
    channel: vi.fn(),
    removeChannel: vi.fn(),
    realtime: { setAuth: vi.fn() },
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
  };
  return {
    handlers,
    channel,
    client,
    unsubscribeAuth,
    status: undefined as undefined | ((status: string, error?: Error) => void),
    authChanged: undefined as undefined | ((event: string, session: { access_token?: string } | null) => void),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => realtime.client,
}));

function attempt(id: string, violationCount: number, lastSeenAt = "one") {
  return {
    id,
    exam_id: "exam-1",
    status: "in_progress",
    current_position: 2,
    violation_count: violationCount,
    last_seen_at: lastSeenAt,
  };
}

function emitAttempt(row: ReturnType<typeof attempt>) {
  realtime.handlers.get("attempts")?.({ old: { id: row.id }, new: row });
}

function emitViolation() {
  realtime.handlers.get("violation_events")?.({ old: {}, new: {} });
}

async function settleRealtimeSetup() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  realtime.handlers.clear();
  realtime.channel.on.mockReset().mockImplementation(
    (event: string, filter: { table?: string }, handler: (payload: Record<string, unknown>) => void) => {
      realtime.handlers.set(event === "system" ? "system" : String(filter.table), handler);
      return realtime.channel;
    },
  );
  realtime.status = undefined;
  realtime.authChanged = undefined;
  realtime.channel.subscribe.mockReset().mockImplementation((callback?: (status: string, error?: Error) => void) => { realtime.status = callback; return realtime.channel; });
  realtime.client.channel.mockReset().mockReturnValue(realtime.channel);
  realtime.client.removeChannel.mockReset().mockResolvedValue(undefined);
  realtime.client.realtime.setAuth.mockReset().mockResolvedValue(undefined);
  realtime.client.auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "token-1" } }, error: null });
  realtime.unsubscribeAuth.mockReset();
  realtime.client.auth.onAuthStateChange.mockReset().mockImplementation((callback: typeof realtime.authChanged) => {
    realtime.authChanged = callback;
    return { data: { subscription: { unsubscribe: realtime.unsubscribeAuth } } };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useViolationRealtime", () => {
  it("sets the session token before subscribing, refreshes it, and cleans up auth", async () => {
    const hook = renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [],
      onRefresh: vi.fn(),
      onFlagged: vi.fn(),
    }));
    await settleRealtimeSetup();

    expect(realtime.client.realtime.setAuth).toHaveBeenCalledWith("token-1");
    expect(realtime.client.realtime.setAuth.mock.invocationCallOrder[0]).toBeLessThan(
      realtime.client.channel.mock.invocationCallOrder[0]!,
    );

    act(() => realtime.authChanged?.("TOKEN_REFRESHED", { access_token: "token-2" }));
    await settleRealtimeSetup();
    expect(realtime.client.realtime.setAuth).toHaveBeenLastCalledWith("token-2");

    hook.unmount();
    expect(realtime.unsubscribeAuth).toHaveBeenCalledTimes(1);
    expect(realtime.client.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it("does not subscribe anonymously and enables the existing fallback when there is no session", async () => {
    realtime.client.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const onRefresh = vi.fn();
    const hook = renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [],
      onRefresh,
      onFlagged: vi.fn(),
    }));
    await settleRealtimeSetup();

    expect(realtime.client.realtime.setAuth).not.toHaveBeenCalled();
    expect(realtime.client.channel).not.toHaveBeenCalled();
    expect(hook.result.current.liveUpdatesPaused).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("ignores last_seen_at-only updates with realistic primary-key-only old rows", async () => {
    const onRefresh = vi.fn();
    const onFlagged = vi.fn();
    const onAttemptUpdated = vi.fn();
    renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [attempt("attempt-1", 12)],
      onRefresh,
      onFlagged,
      onAttemptUpdated,
    }));
    await settleRealtimeSetup();

    act(() => emitAttempt(attempt("attempt-1", 12, "two")));
    await act(() => vi.advanceTimersByTimeAsync(2_100));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onFlagged).not.toHaveBeenCalled();
    expect(onAttemptUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "attempt-1", last_seen_at: "two" }));
  });

  it("ignores extra Phase 4 seed fields outside the material allowlist", async () => {
    const onRefresh = vi.fn();
    const onFlagged = vi.fn();
    renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [{
        ...attempt("attempt-1", 4),
        candidate_name: "Synthetic Candidate",
        outlet: "Synthetic Outlet",
        answered_count: 7,
      }],
      onRefresh,
      onFlagged,
    }));
    await settleRealtimeSetup();

    act(() => emitAttempt(attempt("attempt-1", 4, "two")));
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onFlagged).not.toHaveBeenCalled();
  });

  it("uses the seeded count for a real threshold crossing", async () => {
    const onRefresh = vi.fn();
    const onFlagged = vi.fn();
    renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [attempt("attempt-1", 9)],
      onRefresh,
      onFlagged,
    }));
    await settleRealtimeSetup();

    act(() => emitAttempt(attempt("attempt-1", 10, "two")));
    expect(onFlagged).toHaveBeenCalledWith("attempt-1");
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes but never flags an attempt missing from the initial cache", async () => {
    const onRefresh = vi.fn();
    const onFlagged = vi.fn();
    renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [],
      onRefresh,
      onFlagged,
    }));
    await settleRealtimeSetup();

    act(() => emitAttempt(attempt("unknown", 14)));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onFlagged).not.toHaveBeenCalled();
  });

  it("holds callbacks and threshold in refs without resubscribing", async () => {
    const firstRefresh = vi.fn();
    const latestRefresh = vi.fn();
    const firstFlagged = vi.fn();
    const latestFlagged = vi.fn();
    const hook = renderHook(
      ({ threshold, onRefresh, onFlagged }) => useViolationRealtime({
        examId: "exam-1",
        threshold,
        initialAttempts: [attempt("attempt-1", 9)],
        onRefresh,
        onFlagged,
      }),
      { initialProps: { threshold: 10, onRefresh: firstRefresh, onFlagged: firstFlagged } },
    );
    await settleRealtimeSetup();

    hook.rerender({ threshold: 12, onRefresh: latestRefresh, onFlagged: latestFlagged });
    act(() => emitAttempt(attempt("attempt-1", 12, "two")));
    await act(() => vi.advanceTimersByTimeAsync(200));

    expect(realtime.client.channel).toHaveBeenCalledTimes(1);
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(firstFlagged).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledTimes(1);
    expect(latestFlagged).toHaveBeenCalledWith("attempt-1");
  });

  it("flushes a continuously extended trailing debounce at the two-second max wait", async () => {
    const onRefresh = vi.fn();
    renderHook(() => useViolationRealtime({
      examId: "exam-1",
      threshold: 10,
      initialAttempts: [],
      onRefresh,
      onFlagged: vi.fn(),
    }));
    await settleRealtimeSetup();

    for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
      act(emitViolation);
      await act(() => vi.advanceTimersByTimeAsync(100));
    }
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("clears a pending refresh on unmount and resubscribes only when examId changes", async () => {
    const onRefresh = vi.fn();
    const hook = renderHook(
      ({ examId }) => useViolationRealtime({
        examId,
        threshold: 10,
        initialAttempts: [],
        onRefresh,
        onFlagged: vi.fn(),
      }),
      { initialProps: { examId: "exam-1" } },
    );
    await settleRealtimeSetup();
    act(emitViolation);
    hook.rerender({ examId: "exam-2" });
    await settleRealtimeSetup();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);

    act(emitViolation);
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports a paused channel until Realtime subscribes again", async () => {
    const hook = renderHook(() => useViolationRealtime({ examId: "exam-1", threshold: 10, initialAttempts: [], onRefresh: vi.fn(), onFlagged: vi.fn() }));
    await settleRealtimeSetup();
    act(() => realtime.status?.("CHANNEL_ERROR"));
    expect(hook.result.current.liveUpdatesPaused).toBe(true);
    act(() => realtime.status?.("SUBSCRIBED"));
    expect(hook.result.current.liveUpdatesPaused).toBe(false);
  });

  it("pauses and falls back for terminal states, callback errors, and system errors", async () => {
    const onRefresh = vi.fn();
    const hook = renderHook(() => useViolationRealtime({ examId: "exam-1", threshold: 10, initialAttempts: [], onRefresh, onFlagged: vi.fn() }));
    await settleRealtimeSetup();

    for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
      act(() => realtime.status?.(status));
      expect(hook.result.current.liveUpdatesPaused).toBe(true);
      act(() => realtime.status?.("SUBSCRIBED"));
      expect(hook.result.current.liveUpdatesPaused).toBe(false);
    }

    act(() => realtime.status?.("SUBSCRIBED", new Error("server rejected subscription")));
    expect(hook.result.current.liveUpdatesPaused).toBe(true);
    act(() => realtime.status?.("SUBSCRIBED"));
    act(() => realtime.handlers.get("system")?.({ status: "error", message: "Unable to subscribe to changes" }));
    expect(hook.result.current.liveUpdatesPaused).toBe(true);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("debounces the affected attempt id for violation event and count changes", async () => {
    const onViolationChanged = vi.fn();
    renderHook(() => useViolationRealtime({ examId: "exam-1", threshold: 10, initialAttempts: [attempt("attempt-1", 1)], onRefresh: vi.fn(), onFlagged: vi.fn(), onViolationChanged }));
    await settleRealtimeSetup();
    act(() => realtime.handlers.get("violation_events")?.({ old: {}, new: { attempt_id: "attempt-1" } }));
    act(() => emitAttempt(attempt("attempt-1", 2)));
    expect(onViolationChanged).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(onViolationChanged).toHaveBeenCalledTimes(1);
    expect(onViolationChanged).toHaveBeenCalledWith("attempt-1");
  });
});
