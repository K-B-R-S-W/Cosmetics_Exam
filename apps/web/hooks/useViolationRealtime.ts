"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 200;
const REFRESH_MAX_WAIT_MS = 2_000;

export type InitialViolationAttempt = {
  id: string;
  violation_count: number;
  [key: string]: unknown;
};

type MaterialAttempt = Record<string, unknown> & {
  id: string;
  violation_count: number;
};

const MATERIAL_ATTEMPT_COLUMNS = [
  "status",
  "violation_count",
  "current_position",
  "extra_minutes",
  "acknowledged_at",
  "joined_at",
  "submitted_at",
  "submit_reason",
] as const;

function materialAttempt(row: Record<string, unknown>): MaterialAttempt {
  const material: Record<string, unknown> = {};
  for (const key of MATERIAL_ATTEMPT_COLUMNS) material[key] = row[key];
  return {
    ...material,
    id: String(row.id),
    violation_count: Number(row.violation_count ?? 0),
  };
}

function sameMaterial(left: MaterialAttempt, right: MaterialAttempt): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(
    (key) => JSON.stringify(left[key]) === JSON.stringify(right[key]),
  );
}

export function useViolationRealtime({
  examId,
  threshold,
  initialAttempts,
  onRefresh,
  onFlagged,
  onAttemptUpdated,
  onViolationChanged,
}: {
  examId: string | null;
  threshold: number;
  initialAttempts: InitialViolationAttempt[];
  onRefresh: () => void;
  onFlagged: (attemptId: string) => void;
  onAttemptUpdated?: (attempt: Record<string, unknown>) => void;
  onViolationChanged?: (attemptId: string | null) => void;
}) {
  const callbacks = useRef({ onRefresh, onFlagged, onAttemptUpdated, onViolationChanged, threshold });
  const materialCache = useRef(new Map<string, MaterialAttempt>());
  const [liveUpdatesPaused, setLiveUpdatesPaused] = useState(false);

  useEffect(() => {
    callbacks.current = { onRefresh, onFlagged, onAttemptUpdated, onViolationChanged, threshold };
  }, [onAttemptUpdated, onFlagged, onRefresh, onViolationChanged, threshold]);

  useEffect(() => {
    materialCache.current.clear();
  }, [examId]);

  useEffect(() => {
    for (const attempt of initialAttempts) {
      if (!materialCache.current.has(attempt.id)) {
        materialCache.current.set(attempt.id, materialAttempt(attempt));
      }
    }
  }, [examId, initialAttempts]);

  useEffect(() => {
    if (!examId) return;
    const client = createBrowserSupabaseClient();
    let active = true;
    let channel: ReturnType<typeof client.channel> | null = null;
    let unsubscribeAuth: (() => void) | null = null;
    let refreshTimer: number | null = null;
    let refreshWindowStartedAt: number | null = null;
    const changedViolationAttempts = new Set<string | null>();

    const flushRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshWindowStartedAt = null;
      callbacks.current.onRefresh();
      for (const attemptId of changedViolationAttempts) callbacks.current.onViolationChanged?.(attemptId);
      changedViolationAttempts.clear();
    };

    const scheduleRefresh = () => {
      const now = Date.now();
      refreshWindowStartedAt ??= now;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const remaining = REFRESH_MAX_WAIT_MS - (now - refreshWindowStartedAt);
      if (remaining <= 0) {
        flushRefresh();
        return;
      }
      refreshTimer = window.setTimeout(
        flushRefresh,
        Math.min(REFRESH_DEBOUNCE_MS, remaining),
      );
    };

    const subscribe = () => {
      channel = client
      .channel(`violations:${examId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "violation_events" },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown>;
          changedViolationAttempts.add(typeof row.attempt_id === "string" ? row.attempt_id : null);
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "attempts",
          filter: `exam_id=eq.${examId}`,
        },
        (payload) => {
          callbacks.current.onAttemptUpdated?.(payload.new as Record<string, unknown>);
          const after = materialAttempt(payload.new as Record<string, unknown>);
          const previous = materialCache.current.get(after.id);
          materialCache.current.set(after.id, after);

          if (!previous) {
            scheduleRefresh();
            return;
          }
          if (sameMaterial(previous, after)) return;

          if (previous.violation_count !== after.violation_count) changedViolationAttempts.add(after.id);

          const currentThreshold = callbacks.current.threshold;
          if (
            previous.violation_count < currentThreshold &&
            after.violation_count >= currentThreshold
          ) {
            callbacks.current.onFlagged(after.id);
          }
          scheduleRefresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "exams", filter: `id=eq.${examId}` },
        scheduleRefresh,
      )
      .on("system", {}, (payload) => {
        if (payload?.status === "error") setLiveUpdatesPaused(true);
      })
      .subscribe((status, error) => {
        if (error || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveUpdatesPaused(true);
        } else if (status === "SUBSCRIBED") {
          setLiveUpdatesPaused(false);
        }
      });
    };

    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session?.access_token) {
        void client.realtime.setAuth(session.access_token).catch(() => {
          if (active) setLiveUpdatesPaused(true);
        });
      } else if (event === "SIGNED_OUT" && active) {
        setLiveUpdatesPaused(true);
      }
    });
    unsubscribeAuth = () => authListener.subscription.unsubscribe();

    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!active) return;
        if (error || !accessToken) {
          setLiveUpdatesPaused(true);
          return;
        }
        await client.realtime.setAuth(accessToken);
        if (active) subscribe();
      } catch {
        if (active) setLiveUpdatesPaused(true);
      }
    })();

    return () => {
      active = false;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshWindowStartedAt = null;
      unsubscribeAuth?.();
      if (channel) void client.removeChannel(channel);
    };
  }, [examId]);

  return { liveUpdatesPaused };
}
