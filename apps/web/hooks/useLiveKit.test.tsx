// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Room {
    state = "disconnected";
    options: Record<string, unknown>;
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async () => { this.state = "connected"; });
    disconnect = vi.fn(async () => { this.state = "disconnected"; });
    localParticipant = {
      trackPublications: new Map<number, { track: FakeLocalTrack }>(),
      publishTrack: vi.fn(async (track: FakeLocalTrack) => {
        this.localParticipant.trackPublications.set(this.localParticipant.trackPublications.size, { track });
      }),
      unpublishTrack: vi.fn(async (track: FakeLocalTrack) => {
        for (const [key, publication] of this.localParticipant.trackPublications) {
          if (publication.track === track) this.localParticipant.trackPublications.delete(key);
        }
      }),
    };
    constructor(options: Record<string, unknown>) { this.options = options; rooms.push(this); }
    on(event: string, handler: (...args: unknown[]) => void) { const set = this.handlers.get(event) ?? new Set(); set.add(handler); this.handlers.set(event, set); }
    off(event: string, handler: (...args: unknown[]) => void) { this.handlers.get(event)?.delete(handler); }
    emit(event: string) {
      if (event === "disconnected") {
        this.state = "disconnected";
        if (this.options.stopLocalTrackOnUnpublish !== false) {
          this.localParticipant.trackPublications.forEach((publication) => publication.track.stop());
        }
        this.localParticipant.trackPublications.clear();
      }
      this.handlers.get(event)?.forEach((handler) => handler());
    }
  }
  const rooms: Room[] = [];
  return { createLocalTracks: vi.fn(), rooms, Room };
});

class FakeMediaTrack extends EventTarget {
  kind: "audio" | "video";
  muted = false;
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn(() => { this.readyState = "ended"; });
  constructor(kind: "audio" | "video") { super(); this.kind = kind; }
}

class FakeLocalTrack {
  kind: "audio" | "video";
  mediaStreamTrack: FakeMediaTrack;
  stop = vi.fn(() => this.mediaStreamTrack.stop());
  constructor(kind: "audio" | "video") { this.kind = kind; this.mediaStreamTrack = new FakeMediaTrack(kind); }
}

vi.mock("livekit-client", () => ({
  ConnectionState: { Disconnected: "disconnected", Connected: "connected" },
  RoomEvent: { Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected" },
  Track: { Kind: { Video: "video", Audio: "audio" }, Source: { Camera: "camera", Microphone: "microphone" } },
  Room: mocks.Room,
  createLocalTracks: mocks.createLocalTracks,
}));

import { useLiveKit } from "./useLiveKit";
import { useProctoring } from "./useProctoring";
import { candidateEventSchema } from "@/lib/proctoring-input";

class FakeMediaStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}
  getTracks() { return this.tracks; }
}

function grantPermissions(granted = true) {
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: granted ? "granted" : "prompt" }) },
  });
}

class FakeMediaDevices extends EventTarget {}

beforeEach(() => {
  mocks.rooms.length = 0;
  mocks.createLocalTracks.mockReset().mockResolvedValue([new FakeLocalTrack("video"), new FakeLocalTrack("audio")]);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/livekit/token"
    ? Promise.resolve(new Response(JSON.stringify({ token: "token", url: "ws://localhost:7880", room: "exam_e", identity: "c_a" }), { status: 200 }))
    : Promise.resolve(new Response(JSON.stringify({ id: "event" }), { status: 200 }))));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: new FakeMediaDevices() });
  sessionStorage.clear();
  grantPermissions();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("useLiveKit", () => {
  it("publishes one 320x240 camera layer and microphone with simulcast disabled", async () => {
    const hook = renderHook(() => useLiveKit());
    await act(async () => { expect(await hook.result.current.acquireAndConnect()).toBe(true); });
    expect(mocks.createLocalTracks).toHaveBeenCalledWith({
      audio: true,
      video: { resolution: { width: 320, height: 240 }, frameRate: { ideal: 30, max: 30 } },
    });
    const room = mocks.rooms[0]!;
    expect(room.options.stopLocalTrackOnUnpublish).toBe(false);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ simulcast: false, source: "camera" }));
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ simulcast: false, source: "microphone" }));
    expect(hook.result.current.status).toBe("connected");
  });

  it("caps Android capture at 15 fps", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Android Chrome" });
    const hook = renderHook(() => useLiveKit());
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    expect(mocks.createLocalTracks.mock.calls[0]?.[0].video.frameRate).toEqual({ ideal: 15, max: 15 });
  });

  it("silently reacquires only after Permissions API confirms both grants", async () => {
    const hook = renderHook(() => useLiveKit());
    await act(async () => { expect(await hook.result.current.trySilentReacquire()).toBe(true); });
    expect(navigator.permissions.query).toHaveBeenCalledWith({ name: "camera" });
    expect(navigator.permissions.query).toHaveBeenCalledWith({ name: "microphone" });
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
  });

  it("does not attempt capture when Permissions API is unavailable even with the session hint", async () => {
    sessionStorage.setItem("candidateMediaPermissionGranted", "1");
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    const hook = renderHook(() => useLiveKit());
    await act(async () => { expect(await hook.result.current.trySilentReacquire()).toBe(false); });
    expect(mocks.createLocalTracks).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("permission_required");
  });

  it("reports reconnecting and recovers without replacing local tracks", async () => {
    const hook = renderHook(() => useLiveKit());
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    const room = mocks.rooms[0]!;
    await waitFor(() => expect(room.handlers.get("reconnecting")?.size).toBe(1));
    act(() => room.emit("reconnecting"));
    expect(hook.result.current.connectionLost).toBe(true);
    act(() => room.emit("reconnected"));
    expect(hook.result.current.connectionLost).toBe(false);
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
  });

  it("keeps tracks live through terminal disconnect and republishes the same tracks as a LiveKit-only episode", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => {
      const liveKit = useLiveKit();
      useProctoring({
        enabled: true,
        inProgress: false,
        mediaTracks: liveKit.mediaTracks,
        liveKitDisconnected: liveKit.connectionLost,
      });
      return liveKit;
    });
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    const room = mocks.rooms[0]!;
    const originalTracks = [...hook.result.current.mediaTracks];
    act(() => room.emit("disconnected"));
    expect(originalTracks.every(({ track }) => track.readyState === "live")).toBe(true);
    expect(hook.result.current.cameraLost).toBe(false);
    expect(hook.result.current.microphoneLost).toBe(false);
    expect(hook.result.current.connectionLost).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); });
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(4);
    expect(room.localParticipant.publishTrack.mock.calls[2]?.[0]).toBe(room.localParticipant.publishTrack.mock.calls[0]?.[0]);
    expect(room.localParticipant.publishTrack.mock.calls[3]?.[0]).toBe(room.localParticipant.publishTrack.mock.calls[1]?.[0]);
    expect(hook.result.current.connectionLost).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const mediaEvents = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url) === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .filter((body) => body.type === "CAMERA_LOST" || body.type === "MIC_LOST");
    expect(mediaEvents).toHaveLength(2);
    expect(mediaEvents.every((body) => body.meta?.source === "livekit")).toBe(true);
  });

  it("reacquires and republishes an ended camera on devicechange", async () => {
    vi.useFakeTimers();
    const originalVideo = new FakeLocalTrack("video");
    const originalAudio = new FakeLocalTrack("audio");
    const replacementVideo = new FakeLocalTrack("video");
    mocks.createLocalTracks
      .mockReset()
      .mockResolvedValueOnce([originalVideo, originalAudio])
      .mockRejectedValueOnce(new Error("camera_not_present"))
      .mockResolvedValueOnce([replacementVideo]);
    const hook = renderHook(() => {
      const liveKit = useLiveKit();
      useProctoring({ enabled: true, inProgress: false, mediaTracks: liveKit.mediaTracks });
      return liveKit;
    });
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    originalVideo.mediaStreamTrack.readyState = "ended";
    act(() => originalVideo.mediaStreamTrack.dispatchEvent(new Event("ended")));
    expect(hook.result.current.cameraLost).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => { navigator.mediaDevices.dispatchEvent(new Event("devicechange")); await Promise.resolve(); await Promise.resolve(); });
    expect(hook.result.current.cameraLost).toBe(false);
    expect(originalVideo.stop).toHaveBeenCalledTimes(1);
    expect(mocks.rooms[0]!.localParticipant.unpublishTrack).toHaveBeenCalledWith(originalVideo, false);
    expect(hook.result.current.mediaTracks.find(({ kind }) => kind === "video")?.track).toBe(replacementVideo.mediaStreamTrack);
    expect(mocks.rooms[0]!.localParticipant.publishTrack).toHaveBeenLastCalledWith(replacementVideo, expect.objectContaining({ source: "camera", simulcast: false }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    const cameraEvent = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url) === "/api/events")
      .map((call) => candidateEventSchema.parse(JSON.parse(String(call[1]?.body))))
      .find((body) => body.type === "CAMERA_LOST");
    expect(cameraEvent?.meta?.source).toBe("track");
  });

  it("does not reacquire a muted track and clears loss on unmute", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useLiveKit());
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    const video = hook.result.current.mediaTracks.find(({ kind }) => kind === "video")!.track as unknown as FakeMediaTrack;
    video.muted = true;
    act(() => video.dispatchEvent(new Event("mute")));
    expect(hook.result.current.cameraLost).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
    video.muted = false;
    act(() => video.dispatchEvent(new Event("unmute")));
    expect(hook.result.current.cameraLost).toBe(false);
  });

  it("stays lost without capture when permission was revoked", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useLiveKit());
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    grantPermissions(false);
    const video = hook.result.current.mediaTracks.find(({ kind }) => kind === "video")!.track as unknown as FakeMediaTrack;
    video.readyState = "ended";
    act(() => video.dispatchEvent(new Event("ended")));
    await act(async () => { navigator.mediaDevices.dispatchEvent(new Event("devicechange")); await Promise.resolve(); await vi.advanceTimersByTimeAsync(3_000); });
    expect(hook.result.current.cameraLost).toBe(true);
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
  });

  it("cancels the ended-track retry loop on stop", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useLiveKit());
    await act(async () => { await hook.result.current.acquireAndConnect(); });
    grantPermissions(false);
    const video = hook.result.current.mediaTracks.find(({ kind }) => kind === "video")!.track as unknown as FakeMediaTrack;
    video.readyState = "ended";
    act(() => video.dispatchEvent(new Event("ended")));
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const permissionChecks = vi.mocked(navigator.permissions.query).mock.calls.length;
    await act(async () => { await hook.result.current.stop(); await vi.advanceTimersByTimeAsync(10_000); });
    expect(vi.mocked(navigator.permissions.query).mock.calls).toHaveLength(permissionChecks);
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
  });
});
