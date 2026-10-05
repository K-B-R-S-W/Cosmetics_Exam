// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeartbeat } from "./useHeartbeat";
const state = { server_time: "2026-10-05T10:00:00.000Z", phase: "waiting", exam: {}, attempt: {}, announcements: [] };
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("useHeartbeat", () => {
  it("posts every ten seconds and stops when disabled", async () => {
    const onState = vi.fn(); const auth = vi.fn();
    const hook = renderHook(({ enabled }) => useHeartbeat(onState, auth, enabled), { initialProps: { enabled: true } });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetch).toHaveBeenCalledTimes(1); expect(onState).toHaveBeenCalledWith(state);
    hook.rerender({ enabled: false }); await act(() => vi.advanceTimersByTimeAsync(30_000)); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["unauthenticated", "session_revoked"] as const)("settles %s under Strict Mode", async (code) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status: 401 }));
    const auth = vi.fn();
    renderHook(() => useHeartbeat(vi.fn(), auth), { wrapper: StrictMode });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(auth).toHaveBeenCalledWith(code);
  });
  it("keeps a concurrent manual nudge one-flight", async () => {
    let release!: () => void; vi.mocked(fetch).mockReturnValue(new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify(state), { status: 200 })); }));
    const hook = renderHook(() => useHeartbeat(vi.fn(), vi.fn()));
    act(() => { void hook.result.current(); void hook.result.current(); });
    expect(fetch).toHaveBeenCalledTimes(1); release(); await act(async () => Promise.resolve());
  });
});
