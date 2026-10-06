"use client";

import {
  ConnectionState,
  createLocalTracks,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
const MEDIA_PERMISSION_HINT = "candidateMediaPermissionGranted";

export type CandidateMediaStatus =
  | "idle"
  | "permission_required"
  | "acquiring"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "stopped";

export type CandidateMediaTrack = {
  kind: "audio" | "video";
  track: MediaStreamTrack;
  source: "track";
};

type TokenBody = { token: string; url: string; room: string; identity: string };

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

async function permissionGranted(name: "camera" | "microphone"): Promise<boolean | null> {
  if (!navigator.permissions?.query) return null;
  try {
    const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state === "granted";
  } catch {
    return null;
  }
}

async function mayReacquireWithoutPrompt(): Promise<boolean> {
  const [camera, microphone] = await Promise.all([
    permissionGranted("camera"),
    permissionGranted("microphone"),
  ]);
  return camera === true && microphone === true;
}

async function requestCandidateToken(): Promise<TokenBody> {
  const response = await fetch("/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ as: "candidate" }),
  });
  if (!response.ok) throw new Error("livekit_token_failed");
  const body = await response.json() as Partial<TokenBody>;
  if (!body.token || !body.url || !body.room || !body.identity) throw new Error("livekit_token_invalid");
  return body as TokenBody;
}

export function useLiveKit() {
  const roomRef = useRef<Room | null>(null);
  const tracksRef = useRef<LocalTrack[]>([]);
  const connectPromise = useRef<Promise<boolean> | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectCount = useRef(0);
  const scheduleReconnectRef = useRef<() => void>(() => undefined);
  const stopping = useRef(false);
  const stopped = useRef(false);
  const [status, setStatus] = useState<CandidateMediaStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaTracks, setMediaTracks] = useState<CandidateMediaTrack[]>([]);
  const [cameraLost, setCameraLost] = useState(false);
  const [microphoneLost, setMicrophoneLost] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
  }, []);

  const updateDeviceState = useCallback(() => {
    const video = tracksRef.current.find((track) => track.kind === Track.Kind.Video)?.mediaStreamTrack;
    const audio = tracksRef.current.find((track) => track.kind === Track.Kind.Audio)?.mediaStreamTrack;
    setCameraLost(Boolean(video && (video.readyState === "ended" || video.muted)));
    setMicrophoneLost(Boolean(audio && (audio.readyState === "ended" || audio.muted)));
  }, []);

  const bindTrackState = useCallback((track: LocalTrack) => {
    const media = track.mediaStreamTrack;
    media.addEventListener("mute", updateDeviceState);
    media.addEventListener("unmute", updateDeviceState);
    media.addEventListener("ended", updateDeviceState);
  }, [updateDeviceState]);

  const ensureTracks = useCallback(async () => {
    if (tracksRef.current.length > 0) return tracksRef.current;
    setStatus("acquiring");
    const frameRate = isAndroid() ? { ideal: 15, max: 15 } : { ideal: 30, max: 30 };
    const tracks = await createLocalTracks({
      audio: true,
      video: { resolution: { width: 320, height: 240 }, frameRate },
    });
    if (stopping.current) {
      tracks.forEach((track) => track.stop());
      throw new Error("livekit_stopping");
    }
    tracksRef.current = tracks;
    tracks.forEach(bindTrackState);
    const mediaTracks = tracks.map((track) => track.mediaStreamTrack);
    setStream(new MediaStream(mediaTracks));
    setMediaTracks(tracks.map((track) => ({
      kind: track.kind === Track.Kind.Video ? "video" : "audio",
      track: track.mediaStreamTrack,
      source: "track",
    })));
    updateDeviceState();
    try { sessionStorage.setItem(MEDIA_PERMISSION_HINT, "1"); } catch { /* hint only */ }
    return tracks;
  }, [bindTrackState, updateDeviceState]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (connectPromise.current) return connectPromise.current;
    if (stopping.current || stopped.current) return false;
    const operation = (async () => {
      try {
        const tracks = await ensureTracks();
        setStatus("connecting");
        const token = await requestCandidateToken();
        if (stopping.current) return false;
        const room = roomRef.current ?? new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        if (room.state !== ConnectionState.Connected) {
          await room.connect(token.url, token.token, { autoSubscribe: false });
        }
        if (stopping.current) return false;
        for (const track of tracks) {
          const alreadyPublished = [...room.localParticipant.trackPublications.values()]
            .some((publication) => publication.track === track);
          if (!alreadyPublished) {
            await room.localParticipant.publishTrack(track, {
              source: track.kind === Track.Kind.Video ? Track.Source.Camera : Track.Source.Microphone,
              simulcast: false,
            });
          }
        }
        reconnectCount.current = 0;
        setConnectionLost(false);
        setStatus("connected");
        return true;
      } catch {
        if (!stopping.current) {
          setConnectionLost(tracksRef.current.length > 0);
          setStatus("failed");
        }
        return false;
      } finally {
        connectPromise.current = null;
      }
    })();
    connectPromise.current = operation;
    return operation;
  }, [ensureTracks]);

  const scheduleReconnect = useCallback(() => {
    if (stopping.current || stopped.current || reconnectTimer.current !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectCount.current, RECONNECT_DELAYS_MS.length - 1)]!;
    reconnectCount.current += 1;
    reconnectTimer.current = window.setTimeout(async () => {
      reconnectTimer.current = null;
      const connected = await connect();
      if (!connected) scheduleReconnectRef.current();
    }, delay);
  }, [connect]);
  useEffect(() => { scheduleReconnectRef.current = scheduleReconnect; }, [scheduleReconnect]);

  const acquireAndConnect = useCallback(async () => {
    stopped.current = false;
    stopping.current = false;
    clearReconnect();
    const connected = await connect();
    if (!connected) scheduleReconnect();
    return connected;
  }, [clearReconnect, connect, scheduleReconnect]);

  const trySilentReacquire = useCallback(async () => {
    if (tracksRef.current.length > 0 || connectPromise.current) return true;
    let hinted = false;
    try { hinted = sessionStorage.getItem(MEDIA_PERMISSION_HINT) === "1"; } catch { /* hint only */ }
    const granted = await mayReacquireWithoutPrompt();
    if (!granted) {
      // The session flag can explain why recovery was attempted, but never authorises a prompt.
      void hinted;
      setStatus("permission_required");
      setCameraLost(true);
      setMicrophoneLost(true);
      return false;
    }
    return acquireAndConnect();
  }, [acquireAndConnect]);

  const stop = useCallback(async () => {
    if (stopping.current || stopped.current) return;
    stopping.current = true;
    stopped.current = true;
    clearReconnect();
    const room = roomRef.current;
    roomRef.current = null;
    const tracks = tracksRef.current;
    tracksRef.current = [];
    tracks.forEach((track) => track.stop());
    setStream(null);
    setMediaTracks([]);
    setConnectionLost(false);
    setCameraLost(false);
    setMicrophoneLost(false);
    if (room) await room.disconnect(false).catch(() => undefined);
    setStatus("stopped");
    stopping.current = false;
  }, [clearReconnect]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const reconnecting = () => {
      if (stopping.current) return;
      setConnectionLost(true);
      setStatus("reconnecting");
    };
    const reconnected = () => {
      reconnectCount.current = 0;
      setConnectionLost(false);
      setStatus("connected");
    };
    const disconnected = () => {
      if (stopping.current || stopped.current) return;
      setConnectionLost(true);
      setStatus("reconnecting");
      scheduleReconnect();
    };
    room.on(RoomEvent.Reconnecting, reconnecting);
    room.on(RoomEvent.Reconnected, reconnected);
    room.on(RoomEvent.Disconnected, disconnected);
    return () => {
      room.off(RoomEvent.Reconnecting, reconnecting);
      room.off(RoomEvent.Reconnected, reconnected);
      room.off(RoomEvent.Disconnected, disconnected);
    };
  }, [scheduleReconnect, status]);

  useEffect(() => () => { void stop(); }, [stop]);

  return {
    status,
    stream,
    mediaTracks,
    cameraLost,
    microphoneLost,
    connectionLost,
    acquireAndConnect,
    trySilentReacquire,
    stop,
  };
}
