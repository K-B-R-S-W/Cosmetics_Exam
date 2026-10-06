// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const audioTrackOne = { kind: "audio", attach: vi.fn(), detach: vi.fn() };
  const audioTrackTwo = { kind: "audio", attach: vi.fn(), detach: vi.fn() };
  const firstPublications = new Map([
    ["audio", { source: "microphone", track: audioTrackOne, setSubscribed: vi.fn() }],
    ["video", { source: "camera", track: null, setSubscribed: vi.fn() }],
  ]);
  const secondPublications = new Map([
    ["audio", { source: "microphone", track: audioTrackTwo, setSubscribed: vi.fn() }],
    ["video", { source: "camera", track: null, setSubscribed: vi.fn() }],
  ]);
  const participants = [
    { identity: "c_attempt-1", trackPublications: firstPublications },
    { identity: "c_attempt-2", trackPublications: secondPublications },
  ];
  const connect = vi.fn().mockResolvedValue(undefined);
  class Room {
    state = "connected";
    remoteParticipants = new Map(participants.map((participant) => [participant.identity, participant]));
    handlers = new Map<string, (...args: unknown[]) => void>();
    startAudio = vi.fn().mockResolvedValue(undefined);
    connect = connect;
    disconnect = vi.fn().mockResolvedValue(undefined);
    on(event: string, callback: (...args: unknown[]) => void) { this.handlers.set(event, callback); }
  }
  return { Room, connect, firstPublications, secondPublications, participants, audioTrackOne, audioTrackTwo, rooms: [] as Room[] };
});
vi.mock("livekit-client", () => ({
  ConnectionState: { Connected: "connected" },
  Room: class extends mocks.Room { constructor() { super(); mocks.rooms.push(this); } },
  RoomEvent: { ParticipantConnected: "participantConnected", ParticipantDisconnected: "participantDisconnected", TrackPublished: "trackPublished", TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed", Reconnecting: "reconnecting", Reconnected: "reconnected", Disconnected: "disconnected" },
  Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Video: "video", Audio: "audio" } },
}));

import { useAdminLiveKit } from "./useAdminLiveKit";

async function flushAsyncWork() {
  await act(async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); });
}

beforeEach(() => {
  mocks.rooms.length = 0;
  mocks.connect.mockReset().mockResolvedValue(undefined);
  for (const publications of [mocks.firstPublications, mocks.secondPublications]) publications.forEach((publication) => publication.setSubscribed.mockReset());
  for (const track of [mocks.audioTrackOne, mocks.audioTrackTwo]) {
    track.attach.mockReset().mockImplementation(() => document.createElement("audio"));
    track.detach.mockReset();
  }
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ token: "token", url: "ws://localhost:7880" }) }));
});
afterEach(() => { vi.useRealTimers(); document.querySelectorAll("[data-livekit-audio-attempt]").forEach((element) => element.remove()); });

describe("useAdminLiveKit", () => {
  it("attaches only the selected audio and detaches it when switching speakers", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    const room = mocks.rooms[0]!;

    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    expect(room.startAudio).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-1"]')).toBeTruthy();
    expect(mocks.firstPublications.get("audio")!.setSubscribed).toHaveBeenLastCalledWith(true);

    await act(async () => { await hook.result.current.toggleSpeaker("attempt-2"); });
    expect(room.startAudio).toHaveBeenCalledTimes(2);
    expect(mocks.audioTrackOne.detach).toHaveBeenCalled();
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-1"]')).toBeNull();
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-2"]')).toBeTruthy();
  });

  it("attaches TrackSubscribed audio and detaches it on TrackUnsubscribed and speaker off", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    const room = mocks.rooms[0]!;
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    act(() => room.handlers.get("trackSubscribed")?.(mocks.audioTrackOne, mocks.firstPublications.get("audio"), mocks.participants[0]));
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-1"]')).toBeTruthy();
    act(() => room.handlers.get("trackUnsubscribed")?.(mocks.audioTrackOne, mocks.firstPublications.get("audio"), mocks.participants[0]));
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-1"]')).toBeNull();
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    expect(document.querySelector('[data-livekit-audio-attempt="attempt-1"]')).toBeNull();
  });

  it("subscribes a republished microphone for the active speaker", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    const republished = { source: "microphone", track: null, setSubscribed: vi.fn() };
    act(() => mocks.rooms[0]!.handlers.get("trackPublished")?.(republished, mocks.participants[0]));
    expect(republished.setSubscribed).toHaveBeenCalledWith(true);
  });

  it("retries failed connections at 2, 4 and 8 seconds, then clears the banner", async () => {
    vi.useFakeTimers();
    mocks.connect.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await flushAsyncWork();
    expect(hook.result.current.connectionLost).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    for (const [index, delay] of [2_000, 4_000, 8_000].entries()) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
      await flushAsyncWork();
      expect(mocks.rooms).toHaveLength(index + 2);
    }
    expect(mocks.connect).toHaveBeenCalledTimes(4);
    expect(hook.result.current.connectionLost).toBe(false);
  });

  it("retries a terminal disconnect and obtains a fresh token", async () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await flushAsyncWork();
    act(() => mocks.rooms[0]!.handlers.get("disconnected")?.());
    expect(hook.result.current.connectionLost).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await flushAsyncWork();
    expect(mocks.rooms).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.connectionLost).toBe(false);
  });

  it("cancels a pending failed-connect retry on unmount", async () => {
    vi.useFakeTimers();
    mocks.connect.mockRejectedValue(new Error("down"));
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await flushAsyncWork();
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("shows blocked audio and does not subscribe when startAudio fails", async () => {
    const hook = renderHook(() => useAdminLiveKit("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(mocks.rooms[0]?.connect).toHaveBeenCalled());
    mocks.rooms[0]!.startAudio.mockRejectedValueOnce(new Error("blocked"));
    await act(async () => { await hook.result.current.toggleSpeaker("attempt-1"); });
    expect(hook.result.current.audioBlocked).toBe(true);
    expect(hook.result.current.speakerAttemptId).toBeNull();
  });
});
