export type ViolationEvent = { id: string; type: string; occurred_at: string; duration_ms: number | null; counts: boolean; merged_types: string[]; meta: Record<string, unknown> | null; snapshot_url?: string | null };
export type ViolationTimelineItem = ViolationEvent & {
  gap_duration_ms?: number;
  reason?: string;
  grouped_count?: number;
};

const reasons: Record<string, string> = {
  long_gap: "Counted: no heartbeat for at least 2 minutes",
  short_gap: "Returned quickly",
  overlap: "A tab-switch incident already covers this absence",
  reversed_by_focus: "Count reversed after a matching focus incident arrived",
  dismissed: "Dismissed by an admin",
  restored: "Restored by an admin",
};

export function pairViolationEvents(events: ViolationEvent[]): ViolationTimelineItem[] {
  const ordered = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const pairedReconnects = new Set<string>();
  const paired = ordered.flatMap<ViolationTimelineItem>((event, index) => {
    if (pairedReconnects.has(event.id)) return [];
    if (event.type !== "DISCONNECTED") return [event];
    const reconnect = ordered
      .slice(index + 1)
      .find((candidate) => candidate.type === "RECONNECTED" && !pairedReconnects.has(candidate.id));
    if (reconnect) pairedReconnects.add(reconnect.id);
    const reasonKey = typeof event.meta?.count_reason === "string" ? event.meta.count_reason : undefined;
    return [{
      ...event,
      gap_duration_ms: reconnect?.duration_ms ?? undefined,
      reason: reasonKey ? (reasons[reasonKey] ?? reasonKey) : "Waiting for classification",
    }];
  });

  const grouped: ViolationTimelineItem[] = [];
  for (const item of paired) {
    const previous = grouped.at(-1);
    if (
      item.type === "DISCONNECTED" &&
      item.meta?.count_reason === "short_gap" &&
      previous?.type === "DISCONNECTED" &&
      previous.meta?.count_reason === "short_gap"
    ) {
      previous.grouped_count = (previous.grouped_count ?? 1) + 1;
      continue;
    }
    grouped.push(item);
  }
  return grouped.reverse();
}

export function badgeTone(count: number, threshold: number): "neutral" | "amber" | "red" {
  if (count >= threshold) return "red";
  if (count >= Math.ceil(threshold / 2)) return "amber";
  return "neutral";
}
