"use client";

import { useEffect, useRef, useState } from "react";

import { useServerClock } from "@/lib/time";

const ANNOUNCEMENT_THRESHOLDS = [1800, 600, 300, 60];

export function formatExamTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function Timer({ deadline, onExpired }: { deadline: string | null; onExpired?: () => void }) {
  const now = useServerClock();
  const remainingMs = deadline ? Math.max(0, new Date(deadline).getTime() - now()) : 0;
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const previousSeconds = useRef<number | null>(null);
  const announced = useRef(new Set<number>());
  const expired = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (remainingMs === 0 && deadline && !expired.current) {
      expired.current = true;
      onExpired?.();
    }
  }, [deadline, onExpired, remainingMs]);

  useEffect(() => {
    if (totalSeconds <= 0) return;
    for (const threshold of ANNOUNCEMENT_THRESHOLDS) {
      if (
        !announced.current.has(threshold) &&
        totalSeconds <= threshold &&
        (previousSeconds.current === null
          ? totalSeconds === threshold
          : previousSeconds.current > threshold)
      ) {
        announced.current.add(threshold);
        const minutes = threshold / 60;
        setAnnouncement(`${minutes} ${minutes === 1 ? "minute" : "minutes"} left.`);
        break;
      }
    }
    previousSeconds.current = totalSeconds;
  }, [totalSeconds]);

  const stateClass = totalSeconds <= 60 ? "text-alert" : totalSeconds <= 600 ? "text-warn" : "text-ink";
  const accessible = totalSeconds === 0
    ? "Time is up"
    : `${Math.floor(totalSeconds / 3600)} hours ${Math.floor((totalSeconds % 3600) / 60)} minutes ${totalSeconds % 60} seconds left`;
  return (
    <>
      <div role="timer" aria-live="off" className={`text-timer font-bold ${stateClass}`} data-tabular-numbers="true">
        <span aria-hidden="true">{totalSeconds === 0 ? "Time is up" : formatExamTime(remainingMs)}</span>
        <span className="sr-only">{accessible}</span>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </>
  );
}
