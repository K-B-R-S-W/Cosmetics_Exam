// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const publications = new Map([
    ["audio", { source: "microphone", setSubscribed: vi.fn() }],
    ["video", { source: "camera", setSubscribed: vi.fn() }],
  ]);
  const participant = { identity: "c_attempt-1", trackPublications: publications };
  class Room {
    state = "connected";
    remoteParticipants = new Map([["candidate", participant]]);
    handlers = new Map<string, (...args: unknown[]) => void>();
    startAudio = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    on(event: string, callback: (...args: unknown[]) => void) { this.handlers.set(event, callback); }
  }
  return { Room, publications, participant, rooms: [] as Room[] };
});
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected" },
  Room: class extends mocks.Room { constructor() { super(); mocks.rooms.push(this); } },
  RoomEvent: { ParticipantConnected: "participantConnected", ParticipantDisconnected: "participantDisconnected", TrackPublished: "trackPublished", TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed", Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected" },
  Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Video: "video" } },
}));

import { useAdminLiveKit } from "./useAdminLiveKit";

beforeEach(() => {
  mocks.rooms.length = 0;
  mocks.publications.forEach((publication) => publication.setSubscribed.mockReset());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "token", url: "ws://localhost:7880" }), { status: 200 })));
});
afterEach(() => vi.useRealTimers());

describe("useAdminLiveKit", () => {
  it("subscribes all video but audio only after the speaker click calls startAudio", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms).toHaveLength(1));
    const room = mocks.rooms[0]!;
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    expect(mocks.publications.get("video")!.setSubscribed).toHaveBeenCalledWith(true);
    expect(mocks.publications.get("audio")!.setSubscribed).toHaveBeenCalledWith(false);
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    expect(room.startAudio).toHaveBeenCalledTimes(1);
    expect(mocks.publications.get("audio")!.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(hook.result.current.speakerAttemptId).toBe("attempt-1");
  });

  it("shows blocked audio and does not subscribe when startAudio fails", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    mocks.rooms[0]!.startAudio.mockRejectedValueOnce(new Error("blocked"));
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    expect(hook.result.current.audioBlocked).toBe(true);
    expect(hook.result.current.speakerAttemptId).toBeNull();
  });

  it("reconnects with a fresh token after a terminal disconnect", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    vi.useFakeTimers();
    act(() => mocks.rooms[0]!.handlers.get("disconnected")?.());
    expect(hook.result.current.connectionLost).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(mocks.rooms).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
