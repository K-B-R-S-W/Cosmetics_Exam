"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CandidateErrorScreen, CandidateFrame, Notice, useCandidate } from "@/components/candidate/CandidateContext";
import { useExamBroadcast } from "@/lib/broadcast";
import { formatColombo } from "@/lib/format-time";
import { langFor } from "@/lib/lang";
import { formatCountdown, refineServerClock, useServerClock } from "@/lib/time";

const ANNOUNCE_AT_SECONDS = [600, 300, 120, 60];

export function WaitingRoom() {
  const router = useRouter();
  const { state, refreshState } = useCandidate();
  const now = useServerClock();
  const [connectionLost, setConnectionLost] = useState(false);
  const [changedTime, setChangedTime] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [delayed, setDelayed] = useState(false);
  const firstStart = useRef<string | null | undefined>(undefined);
  const previousSeconds = useRef<number | null>(null);
  const announced = useRef(new Set<number>());

  const refresh = useCallback(async () => {
    try {
      const next = await refreshState();
      if (next) refineServerClock(next.server_time);
      setConnectionLost(false);
    } catch {
      setConnectionLost(true);
    }
  }, [refreshState]);

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
    if (!state) return;
    const delay = state.phase === "waiting" && atZero ? 3000 : 10_000;
    const timer = window.setInterval(() => void refresh(), delay);
    return () => window.clearInterval(timer);
  }, [atZero, refresh, state]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayed(atZero), atZero ? 60_000 : 0);
    return () => window.clearTimeout(timer);
  }, [atZero]);

  useEffect(() => {
    if (remainingMs === null || remainingMs <= 0) return;
    const seconds = Math.ceil(remainingMs / 1000);
    for (const threshold of ANNOUNCE_AT_SECONDS) {
      if (
        !announced.current.has(threshold) &&
        seconds <= threshold &&
        (previousSeconds.current === null
          ? seconds === threshold
          : previousSeconds.current > threshold)
      ) {
        announced.current.add(threshold);
        setAnnouncement(`${threshold / 60} ${threshold === 60 ? "minute" : "minutes"} until the exam starts.`);
        break;
      }
    }
    previousSeconds.current = seconds;
  }, [remainingMs]);

  useEffect(() => {
    if (state?.phase === "live") router.push("/exam");
    else if (state?.phase === "submitted") router.push("/done");
  }, [router, state?.phase]);

  if (!state) return <CandidateFrame><p className="text-muted">Loading…</p></CandidateFrame>;
  if (state.phase === "closed") return <CandidateErrorScreen title="This exam has ended." body="The exam is closed." signOut />;

  return <CandidateFrame wide><h1 tabIndex={-1} className="text-title font-bold" lang={langFor(state.exam.title)}>{state.exam.title}</h1>{connectionLost ? <div className="mt-5"><Notice warning>Connection lost. Reconnecting…</Notice></div> : null}{changedTime ? <div className="mt-5"><Notice>{changedTime}</Notice></div> : null}<div className="mt-8">{state.phase === "live" || atZero ? <Notice>The exam is starting…{delayed ? <span className="mt-2 block">This is taking longer than expected. Stay on this page. Tell the exam team if this continues.</span> : null}</Notice> : startAt && remainingMs !== null ? <><p className="text-muted">The exam starts in</p><p className="mt-2 text-timer font-bold" data-tabular-numbers="true">{formatCountdown(remainingMs)}</p><p className="mt-2 text-muted">{formatColombo(startAt)}</p></> : <Notice>The exam team will start the exam. Stay on this page.</Notice>}</div><p className="sr-only" aria-live="polite">{announcement}</p>{state.phase === "waiting" ? <p className="mt-8 text-muted">Stay on this page.</p> : null}{/* TODO Phase 2 batch 2: request the paper before entering the exam screen. */}</CandidateFrame>;
}
