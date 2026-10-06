"use client";

import { ConnectionState, Room, RoomEvent, Track, type RemoteAudioTrack, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type RemoteVideoTrack } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function attemptId(identity: string): string | null {
  return identity.startsWith("c_") ? identity.slice(2) : null;
}

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 10_000] as const;

export function useAdminLiveKit(examId: string | null) {
  const roomRef = useRef<Room | null>(null);
  const speakerAttemptIdRef = useRef<string | null>(null);
  const audioTracksRef = useRef(new Map<string, RemoteAudioTrack>());
  const audioElementsRef = useRef(new Map<string, HTMLMediaElement>());
  const retryAttemptRef = useRef(0);
  const [videoTracks, setVideoTracks] = useState<Record<string, RemoteVideoTrack>>({});
  const [speakerAttemptId, setSpeakerAttemptId] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    if (!examId) return;
    let active = true;
    let reconnectTimer: number | null = null;
    const audioTrackMap = audioTracksRef.current;
    const room = new Room({ adaptiveStream: true, dynacast: false });
    roomRef.current = room;

    const detachAudio = (id: string) => {
      const track = audioTracksRef.current.get(id);
      const element = audioElementsRef.current.get(id);
      if (track && element) track.detach(element);
      element?.remove();
      audioTracksRef.current.delete(id);
      audioElementsRef.current.delete(id);
    };
    const attachAudio = (id: string, track: RemoteAudioTrack) => {
      detachAudio(id);
      const element = track.attach();
      element.hidden = true;
      element.dataset.livekitAudioAttempt = id;
      document.body.append(element);
      audioTracksRef.current.set(id, track);
      audioElementsRef.current.set(id, element);
    };
    const configurePublication = (publication: RemoteTrackPublication, participant?: RemoteParticipant) => {
      if (publication.source === Track.Source.Camera) publication.setSubscribed(true);
      else if (publication.source === Track.Source.Microphone) {
        const id = participant ? attemptId(participant.identity) : null;
        publication.setSubscribed(Boolean(id && speakerAttemptIdRef.current === id));
      }
    };
    const configureParticipant = (participant: RemoteParticipant) => participant.trackPublications.forEach((publication) => configurePublication(publication, participant));
    const subscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (id && track.kind === Track.Kind.Video) setVideoTracks((current) => ({ ...current, [id]: track as RemoteVideoTrack }));
      if (id && track.kind === Track.Kind.Audio && speakerAttemptIdRef.current === id) attachAudio(id, track as RemoteAudioTrack);
    };
    const unsubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (!id) return;
      if (track.kind === Track.Kind.Video) setVideoTracks((current) => { const next = { ...current }; delete next[id]; return next; });
      if (track.kind === Track.Kind.Audio) detachAudio(id);
    };
    const participantLeft = (participant: RemoteParticipant) => {
      const id = attemptId(participant.identity);
      if (!id) return;
      setVideoTracks((current) => { const next = { ...current }; delete next[id]; return next; });
      detachAudio(id);
      if (speakerAttemptIdRef.current === id) {
        speakerAttemptIdRef.current = null;
        setSpeakerAttemptId(null);
      }
    };
    const lost = () => setConnectionLost(true);
    const scheduleReconnect = () => {
      if (!active || reconnectTimer !== null) return;
      const delay = RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, RETRY_DELAYS_MS.length - 1)];
      retryAttemptRef.current += 1;
      reconnectTimer = window.setTimeout(() => setReconnectKey((value) => value + 1), delay);
    };
    const disconnected = () => {
      lost();
      scheduleReconnect();
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
        retryAttemptRef.current = 0;
        setConnectionLost(false);
      } catch {
        if (active) {
          setConnectionLost(true);
          scheduleReconnect();
        }
      }
    })();

    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      for (const id of audioTrackMap.keys()) detachAudio(id);
      roomRef.current = null;
      setVideoTracks({});
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
    for (const id of audioTracksRef.current.keys()) {
      if (id !== next) {
        const track = audioTracksRef.current.get(id);
        const element = audioElementsRef.current.get(id);
        if (track && element) track.detach(element);
        element?.remove();
        audioTracksRef.current.delete(id);
        audioElementsRef.current.delete(id);
      }
    }
    speakerAttemptIdRef.current = next;
    room.remoteParticipants.forEach((participant) => {
      const id = attemptId(participant.identity);
      participant.trackPublications.forEach((publication) => {
        if (publication.source === Track.Source.Microphone) {
          const subscribe = Boolean(next && id === next);
          publication.setSubscribed(subscribe);
          if (subscribe && publication.track?.kind === Track.Kind.Audio && id) {
            const track = publication.track as RemoteAudioTrack;
            const element = track.attach();
            element.hidden = true;
            element.dataset.livekitAudioAttempt = id;
            document.body.append(element);
            audioTracksRef.current.set(id, track);
            audioElementsRef.current.set(id, element);
          }
        }
      });
    });
    setSpeakerAttemptId(next);
  }, [speakerAttemptId]);

  return useMemo(() => ({ videoTracks, speakerAttemptId, connectionLost, audioBlocked, toggleSpeaker }), [audioBlocked, connectionLost, speakerAttemptId, toggleSpeaker, videoTracks]);
}
