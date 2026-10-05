"use client";
import { useEffect, useRef } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function onlyLastSeenChanged(oldRow: Record<string, unknown>, newRow: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]); keys.delete("last_seen_at");
  return [...keys].every((key) => JSON.stringify(oldRow[key]) === JSON.stringify(newRow[key])) && oldRow.last_seen_at !== newRow.last_seen_at;
}

export function useViolationRealtime({ examId, threshold, onRefresh, onFlagged }: { examId: string; threshold: number; onRefresh: () => void; onFlagged: (attemptId: string) => void }) {
  const counts = useRef(new Map<string, number>());
  useEffect(() => {
    const client = createBrowserSupabaseClient();
    const channel = client.channel(`violations:${examId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "violation_events" }, () => onRefresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "attempts", filter: `exam_id=eq.${examId}` }, (payload) => {
        const before = payload.old as Record<string, unknown>; const after = payload.new as Record<string, unknown>;
        if (onlyLastSeenChanged(before, after)) return;
        const id = String(after.id); const count = Number(after.violation_count ?? 0); const previous = counts.current.get(id) ?? Number(before.violation_count ?? 0);
        counts.current.set(id, count); if (previous < threshold && count >= threshold) onFlagged(id); onRefresh();
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [examId, onFlagged, onRefresh, threshold]);
}
