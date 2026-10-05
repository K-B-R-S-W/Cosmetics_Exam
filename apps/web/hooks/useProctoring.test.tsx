// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateEventSchema } from "@/lib/proctoring-input";
import { capEventQueue, type QueuedEvent, useProctoring } from "./useProctoring";

const event = (index: number): QueuedEvent => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, type: "COPY", merged_types: [], opened_at_ms: index, duration_ms: null, meta: null, retries: 0 });

beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 200 }))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useProctoring", () => {
  it("drops the oldest entry when the 50-item queue overflows", () => {
    const capped = capEventQueue(Array.from({ length: 51 }, (_, index) => event(index)));
    expect(capped).toHaveLength(50); expect(capped[0]?.opened_at_ms).toBe(1);
  });

  it("serializes instant events against the real strict server schema", async () => {
    const hook = renderHook(() => useProctoring({ enabled: true, inProgress: false, mediaTracks: [] }));
    act(() => hook.result.current.sendInstant("COPY"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/events");
    expect(call).toBeTruthy();
    expect(candidateEventSchema.parse(JSON.parse(String(call?.[1]?.body)))).toMatchObject({ type: "COPY" });
  });

  it("drops 400 responses and retries 429 with backoff", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 400 })).mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const hook = renderHook(() => useProctoring({ enabled: true, inProgress: false, mediaTracks: [] }));
    act(() => { hook.result.current.sendInstant("COPY"); hook.result.current.sendInstant("PASTE"); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); await Promise.resolve(); });
    expect(hook.result.current.pendingCount()).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.pendingCount()).toBe(0);
  });

  it("logs one reload when mounted in progress", async () => {
    renderHook(() => useProctoring({ enabled: true, inProgress: true, mediaTracks: [] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const bodies = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { type: string });
    expect(bodies.filter((body) => body.type === "RELOAD")).toHaveLength(1);
  });
});
