// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Room {
    state = "disconnected";
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    connect = vi.fn(async () => { this.state = "connected"; });
    disconnect = vi.fn(async () => { this.state = "disconnected"; });
    localParticipant = { trackPublications: new Map(), publishTrack: vi.fn(async () => undefined) };
    constructor() { rooms.push(this); }
    on(event: string, handler: (...args: unknown[]) => void) { const set = this.handlers.get(event) ?? new Set(); set.add(handler); this.handlers.set(event, set); }
    off(event: string, handler: (...args: unknown[]) => void) { this.handlers.get(event)?.delete(handler); }
    emit(event: string) { this.handlers.get(event)?.forEach((handler) => handler()); }
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

beforeEach(() => {
  mocks.rooms.length = 0;
  mocks.createLocalTracks.mockReset().mockResolvedValue([new FakeLocalTrack("video"), new FakeLocalTrack("audio")]);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "token", url: "ws://localhost:7880", room: "exam_e", identity: "c_a" }), { status: 200 })));
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
});
