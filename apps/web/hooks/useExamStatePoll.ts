"use client";

import { useEffect, useRef } from "react";

const POLL_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export function useExamStatePoll(refreshState: () => Promise<unknown>, enabled = true): void {
  const refreshRef = useRef(refreshState);
  useEffect(() => { refreshRef.current = refreshState; }, [refreshState]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | null = null;
    let failures = 0;

    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        try {
          await refreshRef.current();
          failures = 0;
        } catch {
          failures += 1;
        }
        if (active) schedule(failures === 0 ? POLL_MS : Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }, delay);
    };

    schedule(POLL_MS);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);
}
