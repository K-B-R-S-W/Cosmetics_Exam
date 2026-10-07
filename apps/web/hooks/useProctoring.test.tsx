// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateEventSchema } from "@/lib/proctoring-input";
import { candidateEventBody, capEventQueue, type QueuedEvent, useProctoring } from "./useProctoring";

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

  it("serializes the pagehide beacon with the same strict request contract", () => {
    expect(candidateEventSchema.parse(candidateEventBody(event(4), 10))).toEqual({
      id: "00000000-0000-4000-8000-000000000004",
      type: "COPY",
      merged_types: [],
      occurred_ago_ms: 6,
      duration_ms: null,
      meta: null,
      snapshot_jpeg_base64: null,
    });
  });

  it("rounds fractional performance timings to non-negative integers accepted by the real schema", () => {
    const queued = { ...event(5), opened_at_ms: 10.75, duration_ms: 1_234.6 };
    const body = candidateEventBody(queued, 2_010.35);

    expect(body.occurred_ago_ms).toBe(2_000);
    expect(body.duration_ms).toBe(1_235);
    expect(Number.isInteger(body.occurred_ago_ms)).toBe(true);
    expect(Number.isInteger(body.duration_ms)).toBe(true);
    expect(candidateEventSchema.parse(body)).toEqual(body);

    const beforeOpen = candidateEventBody(queued, 9.9);
    expect(beforeOpen.occurred_ago_ms).toBe(0);
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

  it("logs one snapshot-free reload when a fresh mount resumes an in-progress attempt", async () => {
    renderHook(() => useProctoring({ enabled: true, inProgress: true, resumed: true, mediaTracks: [] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const bodies = vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as { type: string; snapshot_jpeg_base64: string | null });
    expect(bodies.filter((body) => body.type === "RELOAD")).toEqual([
      expect.objectContaining({ type: "RELOAD", snapshot_jpeg_base64: null }),
    ]);
  });

  it("does not log reload when first entry becomes in progress after mount", async () => {
    const hook = renderHook(({ inProgress }) => useProctoring({ enabled: true, inProgress, resumed: false, mediaTracks: [] }), {
      initialProps: { inProgress: false },
    });
    hook.rerender({ inProgress: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const reloads = vi.mocked(fetch).mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { type: string })
      .filter(({ type }) => type === "RELOAD");
    expect(reloads).toHaveLength(0);
  });

  it.each([
    [false, 0],
    [true, 1],
  ])("is Strict Mode safe when resumed is %s", async (resumed, expected) => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    renderHook(() => useProctoring({ enabled: true, inProgress: true, resumed, mediaTracks: [] }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const reloads = vi.mocked(fetch).mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { type: string })
      .filter(({ type }) => type === "RELOAD");
    expect(reloads).toHaveLength(expected);
  });

  it("does not log another reload after state refreshes and rerenders", async () => {
    const hook = renderHook(({ inProgress }) => useProctoring({ enabled: true, inProgress, resumed: true, mediaTracks: [] }), {
      initialProps: { inProgress: true },
    });
    hook.rerender({ inProgress: true });
    hook.rerender({ inProgress: false });
    hook.rerender({ inProgress: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const reloads = vi.mocked(fetch).mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)) as { type: string })
      .filter(({ type }) => type === "RELOAD");
    expect(reloads).toHaveLength(1);
  });

  it("shows and clears the inline paste notice while blocking paste", async () => {
    const hook = renderHook(() => useProctoring({ enabled: true, inProgress: true, mediaTracks: [] }));
    const paste = new Event("paste", { cancelable: true });
    act(() => document.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(hook.result.current.pasteBlocked).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(hook.result.current.pasteBlocked).toBe(false);
  });

  it("shows one dismissible warning after a recorded tab-hide incident closes", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
    const hook = renderHook(() => useProctoring({ enabled: true, inProgress: true, mediaTracks: [] }));
    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(hook.result.current.attentionWarning).toBe(true);
    act(() => hook.result.current.dismissAttentionWarning());
    expect(hook.result.current.attentionWarning).toBe(false);
  });

  it("records simultaneous camera and microphone loss as separate episodes", async () => {
    class FakeTrack extends EventTarget {
      kind: "audio" | "video";
      constructor(kind: "audio" | "video") { super(); this.kind = kind; }
    }
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    renderHook(() => useProctoring({
      enabled: true,
      inProgress: true,
      mediaTracks: [
        { kind: "video", track: camera as unknown as MediaStreamTrack, source: "track" },
        { kind: "audio", track: microphone as unknown as MediaStreamTrack, source: "track" },
      ],
    }));
    act(() => {
      camera.dispatchEvent(new Event("mute"));
      microphone.dispatchEvent(new Event("mute"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    act(() => {
      camera.dispatchEvent(new Event("unmute"));
      microphone.dispatchEvent(new Event("unmute"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const types = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))).type);
    expect(types).toContain("CAMERA_LOST");
    expect(types).toContain("MIC_LOST");
  });

  it("records a LiveKit-only outage as non-counting source metadata", async () => {
    const hook = renderHook(({ disconnected }) => useProctoring({
      enabled: true,
      inProgress: true,
      mediaTracks: [],
      liveKitDisconnected: disconnected,
    }), { initialProps: { disconnected: true } });
    hook.rerender({ disconnected: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const mediaEvents = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .filter((body) => body.type === "CAMERA_LOST" || body.type === "MIC_LOST");
    expect(mediaEvents).toHaveLength(2);
    expect(mediaEvents.every((body) => body.meta?.source === "livekit")).toBe(true);
  });

  it("records unavailable permission media as device-source loss", async () => {
    const hook = renderHook(({ unavailable }) => useProctoring({
      enabled: true,
      inProgress: false,
      mediaTracks: [],
      cameraUnavailable: unavailable,
      microphoneUnavailable: unavailable,
    }), { initialProps: { unavailable: true } });
    hook.rerender({ unavailable: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const mediaEvents = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .filter((body) => body.type === "CAMERA_LOST" || body.type === "MIC_LOST");
    expect(mediaEvents).toHaveLength(2);
    expect(mediaEvents.every((body) => body.meta?.source === "track")).toBe(true);
  });

  it("escalates an open LiveKit outage to track source and waits for both sources to recover", async () => {
    class FakeTrack extends EventTarget { kind = "video" as const; }
    const camera = new FakeTrack();
    const tracks = [{ kind: "video" as const, track: camera as unknown as MediaStreamTrack, source: "track" as const }];
    const hook = renderHook(({ disconnected }) => useProctoring({
      enabled: true,
      inProgress: true,
      mediaTracks: tracks,
      liveKitDisconnected: disconnected,
    }), { initialProps: { disconnected: true } });
    act(() => camera.dispatchEvent(new Event("mute")));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    hook.rerender({ disconnected: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const beforeRestore = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .filter((item) => item.type === "CAMERA_LOST");
    expect(beforeRestore).toHaveLength(0);
    act(() => camera.dispatchEvent(new Event("unmute")));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const body = vi.mocked(fetch).mock.calls
      .filter(([url]) => url === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .find((item) => item.type === "CAMERA_LOST");
    expect(body?.meta?.source).toBe("track");
  });
});
