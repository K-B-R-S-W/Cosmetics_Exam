"use client";

import type { RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef } from "react";

import { CandidateBadge } from "@/components/admin/CandidateBadge";
import type { LiveAttempt, LiveStatus } from "@/lib/admin-live";

export function VideoTile({ attempt, status, threshold, progress, videoTrack, speakerOn, onOpen, onToggleSpeaker }: {
  attempt: LiveAttempt;
  status: LiveStatus;
  threshold: number;
  progress: string | null;
  videoTrack?: RemoteVideoTrack;
  speakerOn: boolean;
  onOpen(): void;
  onToggleSpeaker(): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoTrack) return;
    videoTrack.attach(video);
    return () => { videoTrack.detach(video); };
  }, [videoTrack]);
  const accessible = `${attempt.candidate.mer_code} ${attempt.candidate.full_name}, ${status}, ${attempt.violation_count} ${attempt.violation_count === 1 ? "violation" : "violations"}${attempt.violation_count >= threshold ? ", flagged" : ""}`;
  return (
    <article className="min-w-0 border border-hairline bg-surface">
      <button type="button" aria-label={accessible} className="block w-full text-left" onClick={onOpen}>
        <div className="aspect-[4/3] bg-paper">
          {videoTrack ? <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-muted">No camera</div>}
        </div>
        <div className="space-y-1 p-3"><p className="font-bold">{attempt.candidate.mer_code}</p><p className="truncate text-sm">{attempt.candidate.full_name}</p><p className="text-sm font-bold">{status}</p><CandidateBadge merCode={attempt.candidate.mer_code} count={attempt.violation_count} threshold={threshold} />{progress ? <p className="text-sm text-muted">{progress}</p> : null}</div>
      </button>
      <button type="button" aria-pressed={speakerOn} className="m-2 min-h-11 rounded-control border border-line px-3" onClick={onToggleSpeaker}>{speakerOn ? "Turn speaker off" : "Listen"}</button>
    </article>
  );
}
