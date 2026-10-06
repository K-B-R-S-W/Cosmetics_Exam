"use client";

import type { RemoteVideoTrack } from "livekit-client";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { CandidateBadge } from "@/components/admin/CandidateBadge";
import { ViolationTimeline } from "@/components/admin/ViolationTimeline";
import type { LiveAttempt, LiveStatus } from "@/lib/admin-live";
import type { ViolationEvent } from "@/lib/violation-events";

export function CandidatePanel({ attempt, status, threshold, progress, videoTrack, speakerOn, events, eventsLoading, onClose, onToggleSpeaker, onEventsChanged, returnFocus }: {
  attempt: LiveAttempt;
  status: LiveStatus;
  threshold: number;
  progress: string | null;
  videoTrack?: RemoteVideoTrack;
  speakerOn: boolean;
  events: ViolationEvent[];
  eventsLoading: boolean;
  onClose(): void;
  onToggleSpeaker(): void;
  onEventsChanged(): void;
  returnFocus: HTMLElement | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      returnFocus?.focus();
    };
  }, [returnFocus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoTrack) return;
    videoTrack.attach(video);
    return () => { videoTrack.detach(video); };
  }, [videoTrack]);

  const lastSeen = attempt.last_seen_at
    ? new Date(attempt.last_seen_at).toLocaleTimeString("en-LK", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "Not yet";

  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="candidate-panel-title" className="fixed inset-y-0 right-0 z-30 w-full max-w-[440px] overflow-y-auto border-l border-hairline bg-surface p-5 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-sm text-muted">Candidate</p><h2 id="candidate-panel-title" className="text-xl font-bold">{attempt.candidate.mer_code}</h2><p>{attempt.candidate.full_name}</p></div>
        <Button autoFocus variant="quiet" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-5 aspect-[4/3] bg-paper">
        {videoTrack ? <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" aria-label={`Live camera for ${attempt.candidate.mer_code}`} /> : <div className="grid h-full place-items-center text-muted">No camera</div>}
      </div>
      {status === "Camera off" ? <p className="mt-3 text-alert">No video received. The camera may be off, or the connection to the video server may be down.</p> : null}
      <Button className="mt-3" variant="secondary" aria-pressed={speakerOn} onClick={onToggleSpeaker}>{speakerOn ? "Turn speaker off" : "Listen to candidate"}</Button>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-y border-hairline py-4">
        <div><dt className="text-sm text-muted">Status</dt><dd className="font-bold">{status}</dd></div>
        <div><dt className="text-sm text-muted">Progress</dt><dd>{progress ?? "—"}</dd></div>
        <div><dt className="text-sm text-muted">Last seen</dt><dd>{lastSeen}</dd></div>
        <div><dt className="text-sm text-muted">Violations</dt><dd><CandidateBadge merCode={attempt.candidate.mer_code} count={attempt.violation_count} threshold={threshold} /></dd></div>
      </dl>
      <h3 className="mt-6 text-lg font-bold">Incident timeline</h3>
      {eventsLoading ? <p className="mt-3 text-muted">Loading incidents…</p> : events.length ? <div className="mt-3"><ViolationTimeline events={events} onChanged={onEventsChanged} /></div> : <p className="mt-3 text-muted">No incidents recorded.</p>}
    </aside>
  );
}
