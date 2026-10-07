"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StateBody } from "@/lib/candidate-types";

export type DisplayAnnouncement = { id: string; message: string; sent_at: string };
type PendingAnnouncement = StateBody["announcements"][number];
type ClaimBody = { display: boolean; announcement?: DisplayAnnouncement };

const RETRY_MS = [1_000, 2_000, 4_000] as const;
const MAX_ATTEMPTS = 4;
const DISPLAY_MS = 5_000;
const GAP_MS = 1_000;

interface AnnouncementOptions {
  enabled: boolean;
  identityKey: string | null;
  resetKey: number;
}

interface AnnouncementController {
  current: DisplayAnnouncement | null;
  reset(): void;
}

export function useAnnouncements(
  announcements: PendingAnnouncement[],
  { enabled, identityKey, resetKey }: AnnouncementOptions = { enabled: true, identityKey: null, resetKey: 0 },
): AnnouncementController {
  const [current, setCurrent] = useState<DisplayAnnouncement | null>(null);
  const queue = useRef<PendingAnnouncement[]>([]);
  const known = useRef(new Set<string>());
  const tokens = useRef(new Map<string, string>());
  const busy = useRef(false);
  const active = useRef(true);
  const enabledRef = useRef(enabled);
  const generation = useRef(0);
  const identity = useRef(identityKey);
  const reset = useRef(resetKey);
  const lifecycle = useRef(0);
  const timers = useRef(new Set<number>());
  const processNext = useRef<() => void>(() => undefined);
  const claimRef = useRef<(
    item: PendingAnnouncement,
    token: string,
    attempt: number,
    claimGeneration: number,
  ) => void>(() => undefined);

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      if (active.current) callback();
    }, delay);
    timers.current.add(timer);
  }, []);

  const resetAll = useCallback(() => {
    generation.current += 1;
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    queue.current = [];
    known.current.clear();
    tokens.current.clear();
    busy.current = false;
    setCurrent(null);
  }, []);

  const finish = useCallback((claimGeneration: number, delay = 0) => {
    const next = () => {
      if (!active.current || generation.current !== claimGeneration) return;
      busy.current = false;
      processNext.current();
    };
    if (delay > 0) later(next, delay); else next();
  }, [later]);

  const claim = useCallback((
    item: PendingAnnouncement,
    token: string,
    attempt: number,
    claimGeneration: number,
  ) => {
    void (async () => {
      try {
        const response = await fetch(`/api/exam/announcements/${item.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claim_token: token }),
        });
        if (!active.current || generation.current !== claimGeneration) return;
        if (response.status >= 500) {
          if (attempt < MAX_ATTEMPTS) {
            later(
              () => claimRef.current(item, token, attempt + 1, claimGeneration),
              RETRY_MS[attempt - 1]!,
            );
          } else {
            known.current.delete(item.id);
            finish(claimGeneration);
          }
          return;
        }
        if (!response.ok) {
          finish(claimGeneration);
          return;
        }
        let body: ClaimBody;
        try {
          body = await response.json() as ClaimBody;
        } catch {
          finish(claimGeneration);
          return;
        }
        if (!active.current || generation.current !== claimGeneration) return;
        if (!body.display || !body.announcement) {
          finish(claimGeneration);
          return;
        }
        setCurrent(body.announcement);
        later(() => {
          setCurrent(null);
          finish(claimGeneration, GAP_MS);
        }, DISPLAY_MS);
      } catch {
        if (!active.current || generation.current !== claimGeneration) return;
        if (attempt < MAX_ATTEMPTS) {
          later(
            () => claimRef.current(item, token, attempt + 1, claimGeneration),
            RETRY_MS[attempt - 1]!,
          );
        } else {
          known.current.delete(item.id);
          finish(claimGeneration);
        }
      }
    })();
  }, [finish, later]);

  const processQueue = useCallback(() => {
    if (!active.current || !enabledRef.current || busy.current) return;
    const item = queue.current.shift();
    if (!item) return;
    busy.current = true;
    const token = tokens.current.get(item.id) ?? crypto.randomUUID();
    tokens.current.set(item.id, token);
    claimRef.current(item, token, 1, generation.current);
  }, []);

  useEffect(() => {
    claimRef.current = claim;
    processNext.current = processQueue;
  }, [claim, processQueue]);

  useEffect(() => {
    if (identity.current === identityKey && reset.current === resetKey) return;
    identity.current = identityKey;
    reset.current = resetKey;
    resetAll();
  }, [identityKey, resetAll, resetKey]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) processNext.current();
  }, [enabled]);

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
    lifecycle.current += 1;
    active.current = true;
    const scheduledTimers = timers.current;
    return () => {
      const cleanupLifecycle = ++lifecycle.current;
      queueMicrotask(() => {
        if (lifecycle.current !== cleanupLifecycle) return;
        active.current = false;
        generation.current += 1;
        for (const timer of scheduledTimers) window.clearTimeout(timer);
        scheduledTimers.clear();
      });
    };
  }, []);

  return { current, reset: resetAll };
}
