"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CandidatePanel } from "@/components/admin/CandidatePanel";
import { ThresholdControl } from "@/components/admin/ThresholdControl";
import { VideoTile } from "@/components/admin/VideoTile";
import { useAdminLiveKit } from "@/hooks/useAdminLiveKit";
import { useViolationRealtime } from "@/hooks/useViolationRealtime";
import { deriveLiveStatus, progressLabel, sortByMer, type LiveAttempt, type LiveExam, type LiveProgress, type LiveStatus } from "@/lib/admin-live";
import type { ViolationEvent } from "@/lib/violation-events";

type LiveBody = { server_time: string; exams: LiveExam[]; exam: LiveExam | null; attempts: LiveAttempt[]; progress: LiveProgress[] };
type Filter = "All" | "Flagged" | "Offline" | "Camera off" | "Not joined";
const FILTERS: Filter[] = ["All", "Flagged", "Offline", "Camera off", "Not joined"];

export function LiveGrid({ requestedExamId }: { requestedExamId?: string }) {
  const router = useRouter();
  const [body, setBody] = useState<LiveBody>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("All");
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string>();
  const [events, setEvents] = useState<ViolationEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [toast, setToast] = useState<string>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const [missingSince, setMissingSince] = useState<Record<string, number>>({});
  const examId = body?.exam?.id ?? requestedExamId ?? null;
  const liveKit = useAdminLiveKit(examId);

  const loadFull = useCallback(async () => {
    const query = requestedExamId ? `?exam=${encodeURIComponent(requestedExamId)}` : "";
    try {
      const response = await fetch(`/api/admin/live${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("load_failed");
      const next = await response.json() as LiveBody;
      setBody(next);
      setError(undefined);
    } catch {
      setError("The live view could not be loaded. Try again.");
    }
  }, [requestedExamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFull(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFull]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const attempts = useMemo(() => sortByMer(body?.attempts ?? []), [body?.attempts]);
  const attemptById = useMemo(() => new Map(attempts.map((attempt) => [attempt.id, attempt])), [attempts]);
  const progressById = useMemo(() => new Map((body?.progress ?? []).map((item) => [item.attempt_id, item])), [body?.progress]);

  const { liveUpdatesPaused } = useViolationRealtime({
    examId,
    threshold: body?.exam?.flag_threshold ?? 10,
    initialAttempts: attempts,
    onRefresh: loadFull,
    onAttemptUpdated: (row) => {
      setBody((current) => current ? {
        ...current,
        attempts: current.attempts.map((attempt) => attempt.id === row.id ? {
          ...attempt,
          status: typeof row.status === "string" ? row.status as LiveAttempt["status"] : attempt.status,
          current_position: typeof row.current_position === "number" ? row.current_position : attempt.current_position,
          extra_minutes: typeof row.extra_minutes === "number" ? row.extra_minutes : attempt.extra_minutes,
          last_seen_at: typeof row.last_seen_at === "string" || row.last_seen_at === null ? row.last_seen_at : attempt.last_seen_at,
          violation_count: typeof row.violation_count === "number" ? row.violation_count : attempt.violation_count,
          submitted_at: typeof row.submitted_at === "string" || row.submitted_at === null ? row.submitted_at : attempt.submitted_at,
        } : attempt),
      } : current);
    },
    onFlagged: (attemptId) => {
      const attempt = attemptById.get(attemptId);
      if (attempt) setToast(`${attempt.candidate.mer_code} reached the flag threshold.`);
    },
  });

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!body?.exam) return;
    const timer = window.setInterval(() => {
      if (liveUpdatesPaused) {
        void loadFull();
        return;
      }
      void (async () => {
        try {
          const response = await fetch(`/api/admin/live?view=progress&exam=${body.exam!.id}`, { cache: "no-store" });
          if (!response.ok) return;
          const next = await response.json() as { progress: LiveProgress[] };
          setBody((current) => current ? { ...current, progress: next.progress } : current);
        } catch { /* The next poll or Realtime refresh retries quietly. */ }
      })();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [body?.exam, liveUpdatesPaused, loadFull]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMissingSince((current) => {
        const next = { ...current };
        for (const attempt of attempts) {
          if (liveKit.videoTracks[attempt.id] || (attempt.status !== "acknowledged" && attempt.status !== "in_progress")) delete next[attempt.id];
          else next[attempt.id] ??= Date.now();
        }
        return next;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [attempts, liveKit.videoTracks]);

  const statusFor = (attempt: LiveAttempt): LiveStatus => {
    const hasVideo = Boolean(liveKit.videoTracks[attempt.id]);
    return deriveLiveStatus({ attempt, hasVideo, videoMissingSince: missingSince[attempt.id] ?? null, now });
  };

  const rows = attempts.map((attempt) => ({ attempt, status: statusFor(attempt) }));
  const counts = Object.fromEntries(FILTERS.map((name) => [name, name === "All" ? rows.length : rows.filter(({ attempt, status }) => name === "Flagged" ? attempt.violation_count >= (body?.exam?.flag_threshold ?? 10) : status === name).length])) as Record<Filter, number>;
  const visible = rows.filter(({ attempt, status }) => filter === "All" || (filter === "Flagged" ? attempt.violation_count >= (body?.exam?.flag_threshold ?? 10) : status === filter));
  const selected = selectedId ? attemptById.get(selectedId) : undefined;

  const loadEvents = useCallback(async (attemptId: string) => {
    setEventsLoading(true);
    try {
      const response = await fetch(`/api/admin/live/${attemptId}/events`, { cache: "no-store" });
      const next = response.ok ? await response.json() as { events: ViolationEvent[] } : { events: [] };
      setEvents(next.events);
    } finally { setEventsLoading(false); }
  }, []);

  if (!body && !error) return <p>Loading live exam…</p>;
  if (error && !body) return <p role="alert">{error}</p>;
  if (!body?.exam) return <div><h1 className="text-2xl font-bold">Live exam</h1><p className="mt-4">No exam is live or scheduled. Open Exams to schedule one.</p></div>;

  const exam = body.exam;
  const deadline = exam.ends_at ? Date.parse(exam.ends_at) : null;
  const remaining = deadline === null ? null : Math.max(0, deadline - now);

  return (
    <section aria-labelledby="live-title">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div><p className="text-sm text-muted">Live monitoring</p><h1 id="live-title" className="text-2xl font-bold">{exam.title}</h1><p className="mt-1 font-bold">{exam.status === "live" && remaining !== null ? `Time left ${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0")}` : exam.status}</p></div>
        <div className="flex items-end gap-4">
          {body.exams.length > 1 ? <label className="font-bold">Exam<select aria-label="Exam" className="mt-1 block min-h-11 rounded-control border border-line bg-surface px-3" value={exam.id} onChange={(event) => router.replace(`/admin/live?exam=${event.target.value}`)}>{body.exams.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : null}
          <div className="w-32"><ThresholdControl examId={exam.id} initialValue={exam.flag_threshold} disabled={exam.status === "finalized"} /></div>
        </div>
      </div>
      {liveUpdatesPaused ? <p role="status" className="mt-4 border border-warn bg-warn-tint p-3">Live updates paused. Reconnecting…</p> : null}
      {liveKit.connectionLost ? <p role="status" className="mt-4 border border-warn bg-warn-tint p-3">Video is not available. Status, progress and violations still update.</p> : null}
      {liveKit.audioBlocked ? <p role="alert" className="mt-4 border border-warn bg-warn-tint p-3">Audio was blocked by the browser. Click Listen again.</p> : null}
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Candidate filters">{FILTERS.map((name) => <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)} className={`rounded-full border border-line px-4 py-2 ${filter === name ? "bg-ink text-surface" : "bg-surface"}`}>{name} ({counts[name]})</button>)}</div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visible.map(({ attempt, status }) => <VideoTile key={attempt.id} attempt={attempt} status={status} threshold={exam.flag_threshold} progress={progressLabel(exam, attempt, progressById.get(attempt.id))} videoTrack={liveKit.videoTracks[attempt.id]} speakerOn={liveKit.speakerAttemptId === attempt.id} onToggleSpeaker={() => void liveKit.toggleSpeaker(attempt.id)} onOpen={() => { setReturnFocus(document.activeElement as HTMLElement); setSelectedId(attempt.id); void loadEvents(attempt.id); }} />)}</div>
      {!visible.length ? <p className="mt-8 text-center text-muted">No candidates match this filter.</p> : null}
      {selected ? <CandidatePanel attempt={selected} status={statusFor(selected)} threshold={exam.flag_threshold} progress={progressLabel(exam, selected, progressById.get(selected.id))} videoTrack={liveKit.videoTracks[selected.id]} speakerOn={liveKit.speakerAttemptId === selected.id} events={events} eventsLoading={eventsLoading} onToggleSpeaker={() => void liveKit.toggleSpeaker(selected.id)} onEventsChanged={() => { void loadEvents(selected.id); void loadFull(); }} onClose={() => { setSelectedId(undefined); setEvents([]); }} returnFocus={returnFocus} /> : null}
      {toast ? <p role="status" className="fixed bottom-5 right-5 z-40 max-w-sm border border-alert bg-surface p-4 shadow-lg">{toast}</p> : null}
    </section>
  );
}
