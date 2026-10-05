"use client";

import { useEffect, useRef } from "react";
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
}: {
  examId: string;
  threshold: number;
  initialAttempts: InitialViolationAttempt[];
  onRefresh: () => void;
  onFlagged: (attemptId: string) => void;
}) {
  const callbacks = useRef({ onRefresh, onFlagged, threshold });
  const materialCache = useRef(new Map<string, MaterialAttempt>());

  useEffect(() => {
    callbacks.current = { onRefresh, onFlagged, threshold };
  }, [onFlagged, onRefresh, threshold]);

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
    const client = createBrowserSupabaseClient();
    let refreshTimer: number | null = null;
    let refreshWindowStartedAt: number | null = null;

    const flushRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshWindowStartedAt = null;
      callbacks.current.onRefresh();
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

    const channel = client
      .channel(`violations:${examId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "violation_events" },
        scheduleRefresh,
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
          const after = materialAttempt(payload.new as Record<string, unknown>);
          const previous = materialCache.current.get(after.id);
          materialCache.current.set(after.id, after);

          if (!previous) {
            scheduleRefresh();
            return;
          }
          if (sameMaterial(previous, after)) return;

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
      .subscribe();

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshWindowStartedAt = null;
      void client.removeChannel(channel);
    };
  }, [examId]);
}
