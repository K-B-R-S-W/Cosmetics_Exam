// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViolationRealtime } from "./useViolationRealtime";

const realtime = vi.hoisted(() => {
  const handlers = new Map<string, (payload: { old: Record<string, unknown>; new: Record<string, unknown> }) => void>();
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  const client = {
    channel: vi.fn(),
    removeChannel: vi.fn(),
  };
  return { handlers, channel, client, status: undefined as undefined | ((status: string) => void) };
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

beforeEach(() => {
  vi.useFakeTimers();
  realtime.handlers.clear();
  realtime.channel.on.mockReset().mockImplementation(
    (_event: string, filter: { table: string }, handler: (payload: { old: Record<string, unknown>; new: Record<string, unknown> }) => void) => {
      realtime.handlers.set(filter.table, handler);
      return realtime.channel;
    },
  );
  realtime.status = undefined;
  realtime.channel.subscribe.mockReset().mockImplementation((callback?: (status: string) => void) => { realtime.status = callback; return realtime.channel; });
  realtime.client.channel.mockReset().mockReturnValue(realtime.channel);
  realtime.client.removeChannel.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useViolationRealtime", () => {
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
    act(emitViolation);
    hook.rerender({ examId: "exam-2" });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);

    act(emitViolation);
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports a paused channel until Realtime subscribes again", () => {
    const hook = renderHook(() => useViolationRealtime({ examId: "exam-1", threshold: 10, initialAttempts: [], onRefresh: vi.fn(), onFlagged: vi.fn() }));
    act(() => realtime.status?.("CHANNEL_ERROR"));
    expect(hook.result.current.liveUpdatesPaused).toBe(true);
    act(() => realtime.status?.("SUBSCRIBED"));
    expect(hook.result.current.liveUpdatesPaused).toBe(false);
  });
});
