"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StateBody } from "@/lib/candidate-types";

export type DisplayAnnouncement = { id: string; message: string; sent_at: string };
type PendingAnnouncement = StateBody["announcements"][number];
type ClaimBody = { display: boolean; announcement?: DisplayAnnouncement };

const RETRY_MS = 1_000;
const DISPLAY_MS = 5_000;
const GAP_MS = 1_000;

export function useAnnouncements(announcements: PendingAnnouncement[]): DisplayAnnouncement | null {
  const [current, setCurrent] = useState<DisplayAnnouncement | null>(null);
  const queue = useRef<PendingAnnouncement[]>([]);
  const known = useRef(new Set<string>());
  const busy = useRef(false);
  const active = useRef(true);
  const timers = useRef(new Set<number>());
  const processNext = useRef<() => void>(() => undefined);
  const claimRef = useRef<(item: PendingAnnouncement, token: string) => void>(() => undefined);

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      if (active.current) callback();
    }, delay);
    timers.current.add(timer);
  }, []);

  const finish = useCallback((delay = 0) => {
    const next = () => { busy.current = false; processNext.current(); };
    if (delay > 0) later(next, delay); else next();
  }, [later]);

  const claim = useCallback((item: PendingAnnouncement, token: string) => {
    void (async () => {
      try {
        const response = await fetch(`/api/exam/announcements/${item.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claim_token: token }),
        });
        if (response.status >= 500) { later(() => claimRef.current(item, token), RETRY_MS); return; }
        if (!response.ok) { finish(); return; }
        const body = await response.json() as ClaimBody;
        if (!body.display || !body.announcement) { finish(); return; }
        if (!active.current) return;
        setCurrent(body.announcement);
        later(() => {
          setCurrent(null);
          finish(GAP_MS);
        }, DISPLAY_MS);
      } catch {
        later(() => claimRef.current(item, token), RETRY_MS);
      }
    })();
  }, [finish, later]);

  const processQueue = useCallback(() => {
    if (!active.current || busy.current) return;
    const item = queue.current.shift();
    if (!item) return;
    busy.current = true;
    claimRef.current(item, crypto.randomUUID());
  }, []);

  useEffect(() => {
    claimRef.current = claim;
    processNext.current = processQueue;
  }, [claim, processQueue]);

  useEffect(() => {
    const additions = [...announcements]
      .sort((left, right) => left.sent_at.localeCompare(right.sent_at) || left.id.localeCompare(right.id))
      .filter(({ id }) => {
        if (known.current.has(id)) return false;
        known.current.add(id);
        return true;
      });
    queue.current.push(...additions);
    processNext.current();
  }, [announcements]);

  useEffect(() => {
    active.current = true;
    const scheduledTimers = timers.current;
    return () => {
      active.current = false;
      for (const timer of scheduledTimers) window.clearTimeout(timer);
      scheduledTimers.clear();
    };
  }, []);

  return current;
}
