// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeartbeat } from "./useHeartbeat";

const state = {
  server_time: "2026-10-05T10:00:00.000Z",
  phase: "waiting",
  exam: {},
  attempt: {},
  announcements: [],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(jsonResponse(state)),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useHeartbeat", () => {
  it("posts every ten seconds and stops when disabled", async () => {
    const onState = vi.fn();
    const auth = vi.fn();
    const hook = renderHook(
      ({ enabled }) => useHeartbeat(onState, auth, enabled),
      { initialProps: { enabled: true } },
    );
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith(state);
    hook.rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["unauthenticated", "session_revoked"] as const)(
    "stops permanently after %s under Strict Mode",
    async (code) => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: { code } }, 401),
      );
      const auth = vi.fn();
      const hook = renderHook(() => useHeartbeat(vi.fn(), auth), {
        wrapper: StrictMode,
      });

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(auth).toHaveBeenCalledTimes(1);
      expect(auth).toHaveBeenCalledWith(code);
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(180_000));
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await expect(hook.result.current()).resolves.toBeNull();
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("backs off and continues after an ordinary server failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: { code: "internal_error" } }, 500))
      .mockResolvedValueOnce(jsonResponse(state));
    const onState = vi.fn();
    renderHook(() => useHeartbeat(onState, vi.fn()));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(19_999));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenCalledWith(state);
  });

  it("clears the auth stop when disabled and then re-enabled", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ error: { code: "session_revoked" } }, 401))
      .mockResolvedValueOnce(jsonResponse(state));
    const onState = vi.fn();
    const hook = renderHook(
      ({ enabled }) => useHeartbeat(onState, vi.fn(), enabled),
      { initialProps: { enabled: true } },
    );

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await act(async () => {
      await expect(hook.result.current()).resolves.toBeNull();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenCalledWith(state);
  });

  it("keeps a concurrent manual nudge one-flight", async () => {
    let release!: () => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        release = () => resolve(jsonResponse(state));
      }),
    );
    const hook = renderHook(() => useHeartbeat(vi.fn(), vi.fn()));
    act(() => {
      void hook.result.current();
      void hook.result.current();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await act(async () => Promise.resolve());
  });
});
