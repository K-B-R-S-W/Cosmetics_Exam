// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExamStatePoll } from "./useExamStatePoll";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useExamStatePoll", () => {
  it("polls every ten seconds, backs off quietly, and recovers", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue(undefined);
    renderHook(() => useExamStatePoll(refresh));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(19_999));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("continues when enabled and stops immediately when disabled or unmounted", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(({ enabled }) => useExamStatePoll(refresh, enabled), { initialProps: { enabled: true } });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(refresh).toHaveBeenCalledOnce();
    hook.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledOnce();
    hook.unmount();
  });
});
