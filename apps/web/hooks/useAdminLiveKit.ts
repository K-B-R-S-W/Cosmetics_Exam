"use client";

import { ConnectionState, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type RemoteVideoTrack } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function attemptId(identity: string): string | null {
  return identity.startsWith("c_") ? identity.slice(2) : null;
}

export function useAdminLiveKit(examId: string | null) {
  const roomRef = useRef<Room | null>(null);
  const [videoTracks, setVideoTracks] = useState<Record<string, RemoteVideoTrack>>({});
  const [speakerAttemptId, setSpeakerAttemptId] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    if (!examId) return;
    let active = true;
    let reconnectTimer: number | null = null;
    const room = new Room({ adaptiveStream: true, dynacast: false });
    roomRef.current = room;

    const configurePublication = (publication: RemoteTrackPublication) => {
      if (publication.source === Track.Source.Camera) publication.setSubscribed(true);
      else if (publication.source === Track.Source.Microphone) publication.setSubscribed(false);
    };
    const configureParticipant = (participant: RemoteParticipant) => participant.trackPublications.forEach(configurePublication);
    const subscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (id && track.kind === Track.Kind.Video) setVideoTracks((current) => ({ ...current, [id]: track as RemoteVideoTrack }));
    };
    const unsubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (!id || track.kind !== Track.Kind.Video) return;
      setVideoTracks((current) => { const next = { ...current }; delete next[id]; return next; });
    };
    const participantLeft = (participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (!id) return;
      setVideoTracks((current) => { const next = { ...current }; delete next[id]; return next; });
      setSpeakerAttemptId((current) => current === id ? null : current);
    };
    const lost = () => setConnectionLost(true);
    const disconnected = () => {
      lost();
      if (active && reconnectTimer === null) reconnectTimer = window.setTimeout(() => setReconnectKey((value) => value + 1), 5_000);
    };
    const restored = () => setConnectionLost(false);
    room.on(RoomEvent.ParticipantConnected, configureParticipant);
    room.on(RoomEvent.ParticipantDisconnected, participantLeft);
    room.on(RoomEvent.TrackPublished, configurePublication);
    room.on(RoomEvent.TrackSubscribed, subscribed);
    room.on(RoomEvent.TrackUnsubscribed, unsubscribed);
    room.on(RoomEvent.Reconnecting, lost);
    room.on(RoomEvent.Reconnected, restored);
    room.on(RoomEvent.Disconnected, disconnected);

    void (async () => {
      try {
        const response = await fetch("/api/livekit/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as: "admin", exam_id: examId }) });
        if (!response.ok) throw new Error("admin_livekit_token_failed");
        const body = await response.json() as { token: string; url: string };
        await room.connect(body.url, body.token, { autoSubscribe: false });
        if (!active) return;
        room.remoteParticipants.forEach(configureParticipant);
        setConnectionLost(false);
      } catch {
        if (active) setConnectionLost(true);
      }
    })();

    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      roomRef.current = null;
      setVideoTracks({});
      setSpeakerAttemptId(null);
      void room.disconnect(false);
    };
  }, [examId, reconnectKey]);

  const toggleSpeaker = useCallback(async (nextAttemptId: string) => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const next = speakerAttemptId === nextAttemptId ? null : nextAttemptId;
    if (next) {
      try {
        await room.startAudio();
        setAudioBlocked(false);
      } catch {
        setAudioBlocked(true);
        return;
      }
    }
    room.remoteParticipants.forEach((participant) => {
      const id = attemptId(participant.identity);
      participant.trackPublications.forEach((publication) => {
        if (publication.source === Track.Source.Microphone) publication.setSubscribed(Boolean(next && id === next));
      });
    });
    setSpeakerAttemptId(next);
  }, [speakerAttemptId]);

  return useMemo(() => ({ videoTracks, speakerAttemptId, connectionLost, audioBlocked, toggleSpeaker }), [audioBlocked, connectionLost, speakerAttemptId, toggleSpeaker, videoTracks]);
}
