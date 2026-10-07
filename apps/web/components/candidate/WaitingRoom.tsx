"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CandidateErrorScreen, CandidateFrame, CandidatePaperError, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { CandidateAnnouncements } from "@/components/candidate/AnnouncementToast";
import { useCandidateLiveKit } from "@/components/candidate/LiveKitContext";
import { Button } from "@/components/ui/Button";
import { CameraBanner } from "@/components/exam/CameraBanner";
import { FullscreenOverlay } from "@/components/exam/FullscreenOverlay";
import { useProctoring } from "@/hooks/useProctoring";
import { useExamBroadcast } from "@/lib/broadcast";
import { formatColombo } from "@/lib/format-time";
import { langFor } from "@/lib/lang";
import { PAPER_RETRY_DELAY_MS, PAPER_RETRY_NOTICE, usePaperRetryTracker } from "@/lib/paper-retry";
import { formatCountdown, refineServerClock, useServerClock } from "@/lib/time";

const ANNOUNCE_AT_SECONDS = [600, 300, 120, 60];

export function WaitingRoom() {
  const router = useRouter();
  const { state, refreshState, heartbeatNow, loadPaper, markExamHandoff } = useCandidate();
  const media = useCandidateLiveKit();
  const now = useServerClock();
  const [connectionLost, setConnectionLost] = useState(false);
  const [changedTime, setChangedTime] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [delayed, setDelayed] = useState(false);
  const [paperLoad, setPaperLoad] = useState<"idle" | "loading" | "transient">("idle");
  const [paperError, setPaperError] = useState<string | null>(null);
  const [notLiveNotice, setNotLiveNotice] = useState(false);
  const [unexpectedPhase, setUnexpectedPhase] = useState(false);
  const [showPaperRetry, setShowPaperRetry] = useState(false);
  const firstStart = useRef<string | null | undefined>(undefined);
  const previousSeconds = useRef<number | null>(null);
  const announced = useRef(new Set<number>());
  const handoffActive = useRef(false);
  const retryVisibleTimer = useRef<number | null>(null);
  const { recordFailure, resetFailures, showTakingLonger } = usePaperRetryTracker();
  const proctoring = useProctoring({
    enabled: true,
    inProgress: false,
    video: media.previewElement,
    mediaTracks: media.mediaTracks,
    liveKitDisconnected: media.connectionLost,
    cameraUnavailable: media.status === "permission_required",
    microphoneUnavailable: media.status === "permission_required",
  });

  const refresh = useCallback(async () => {
    try {
      const next = await heartbeatNow();
      if (next) refineServerClock(next.server_time);
      setConnectionLost(false);
    } catch {
      setConnectionLost(true);
    }
  }, [heartbeatNow]);

  useExamBroadcast(state?.exam.id ?? null, refresh);

  const startAt = state?.exam.scheduled_start_at ?? null;
  const remainingMs = startAt ? Math.max(0, new Date(startAt).getTime() - now()) : null;
  const atZero = remainingMs === 0;

  useEffect(() => {
    if (!state) return;
    refineServerClock(state.server_time);
    const current = state.exam.scheduled_start_at;
    if (firstStart.current === undefined) firstStart.current = current;
    else if (firstStart.current !== current) {
      firstStart.current = current;
      setChangedTime(current ? `The start time changed to ${formatColombo(current)}.` : "The exam team will start the exam. Stay on this page.");
    }
  }, [state]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayed(atZero), atZero ? 60_000 : 0);
    return () => window.clearTimeout(timer);
  }, [atZero]);

  useEffect(() => {
    if (remainingMs === null || remainingMs <= 0) return;
    const seconds = Math.ceil(remainingMs / 1000);
    for (const threshold of ANNOUNCE_AT_SECONDS) {
      if (!announced.current.has(threshold) && seconds <= threshold && (previousSeconds.current === null ? seconds === threshold : previousSeconds.current > threshold)) {
        announced.current.add(threshold);
        setAnnouncement(`${threshold / 60} ${threshold === 60 ? "minute" : "minutes"} until the exam starts.`);
        break;
      }
    }
    previousSeconds.current = seconds;
  }, [remainingMs]);

  const requestPaper = useCallback(async () => {
    if (handoffActive.current) return;
    handoffActive.current = true;
    setPaperLoad("loading");
    setPaperError(null);
    setNotLiveNotice(false);
    setUnexpectedPhase(false);
    try {
      await loadPaper();
      await refreshState();
      resetFailures();
      if (retryVisibleTimer.current !== null) window.clearTimeout(retryVisibleTimer.current);
      markExamHandoff();
      router.push("/exam");
    } catch (error) {
      handoffActive.current = false;
      if (!(error instanceof CandidatePaperError) || error.status >= 500 || error.code === "service_unavailable") {
        recordFailure();
        setPaperLoad("transient");
        if (retryVisibleTimer.current === null) {
          retryVisibleTimer.current = window.setTimeout(() => setShowPaperRetry(true), 8000);
        }
        return;
      }
      const next = await refreshState().catch(() => null);
      setPaperLoad("idle");
      setPaperError(error.code);
      if (error.code === "not_acknowledged") router.push("/rules");
      else if (error.code === "attempt_closed") router.push("/done");
      else if (error.code === "exam_closed" && next?.attempt.status === "in_progress") router.push("/exam");
      else if (error.code === "exam_not_live" && next?.phase === "waiting") {
        setPaperError(null);
        setNotLiveNotice(true);
      }
      else if (error.code === "exam_not_live" && next?.phase === "closed") {
        // refreshState updates the provider; its route guard owns the closed transition.
      }
      else if (error.code === "exam_not_live") {
        setPaperError(null);
        setUnexpectedPhase(true);
        recordFailure();
        setPaperLoad("transient");
        if (retryVisibleTimer.current === null) {
          retryVisibleTimer.current = window.setTimeout(() => setShowPaperRetry(true), 8000);
        }
      }
    }
  }, [loadPaper, markExamHandoff, recordFailure, refreshState, resetFailures, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (state?.phase === "live" && paperLoad === "idle" && !paperError) void requestPaper();
      else if (state?.phase === "submitted") router.push("/done");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paperError, paperLoad, requestPaper, router, state?.phase]);

  useEffect(() => {
    if (paperLoad !== "transient") return;
    const retry = window.setTimeout(() => { handoffActive.current = false; setPaperLoad("idle"); }, PAPER_RETRY_DELAY_MS);
    return () => window.clearTimeout(retry);
  }, [paperLoad]);

  useEffect(() => () => {
    if (retryVisibleTimer.current !== null) window.clearTimeout(retryVisibleTimer.current);
  }, []);

  if (!state) return <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  if (state.phase === "closed") return <CandidateErrorScreen title="This exam has ended." body="The exam is closed." signOut />;
  if (paperError === "exam_has_no_questions") return <CandidateErrorScreen title="This exam has no questions yet." body="Tell the exam team." signOut />;

  return (
    <CandidateFrame wide>
      <CandidateAnnouncements announcements={state.announcements} />
      <h1 tabIndex={-1} className="text-title font-bold" lang={langFor(state.exam.title)}>{state.exam.title}</h1>
      {connectionLost ? <div className="mt-5"><Notice warning>Connection lost. Reconnecting…</Notice></div> : null}
      <div className="mt-5"><CameraBanner cameraLost={media.cameraLost} microphoneLost={media.microphoneLost} connectionLost={media.connectionLost} /></div>
      {changedTime ? <div className="mt-5"><Notice>{changedTime}</Notice></div> : null}
      {notLiveNotice ? <div className="mt-5"><Notice>The exam hasn&apos;t started yet.</Notice></div> : null}
      <div className="mt-8">
        {state.phase === "live" || atZero ? <Notice>The exam is starting…{delayed ? <span className="mt-2 block">This is taking longer than expected. Stay on this page. Tell the exam team if this continues.</span> : null}</Notice> : startAt && remainingMs !== null ? <><p className="text-muted">The exam starts in</p><p className="mt-2 text-timer font-bold" data-tabular-numbers="true">{formatCountdown(remainingMs)}</p><p className="mt-2 text-muted">{formatColombo(startAt)}</p></> : <Notice>The exam team will start the exam. Stay on this page.</Notice>}
      </div>
      {paperLoad === "transient" ? <div className="mt-5"><Notice warning>Loading your exam…{showTakingLonger || unexpectedPhase ? <span className="mt-2 block">{PAPER_RETRY_NOTICE}</span> : null}</Notice>{showPaperRetry ? <Button className="mt-3" variant="secondary" onClick={() => { handoffActive.current = false; setPaperLoad("idle"); }}>Retry</Button> : null}</div> : null}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {state.phase === "waiting" ? <p className="mt-8 text-muted">Stay on this page.</p> : null}
      <FullscreenOverlay active={proctoring.fullscreenLost} />
    </CandidateFrame>
  );
}
