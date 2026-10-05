import { describe, expect, it } from "vitest";
import { badgeTone, pairViolationEvents } from "./violation-events";
describe("violation display", () => {
  it("pairs a disconnect with its next reconnect and explains the reason", () => {
    const items = pairViolationEvents([
      { id: "d", type: "DISCONNECTED", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: true, merged_types: [], meta: { count_reason: "long_gap" } },
      { id: "r", type: "RECONNECTED", occurred_at: "2026-10-05T10:03:00Z", duration_ms: 180000, counts: false, merged_types: [], meta: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ gap_duration_ms: 180000, reason: "Counted: no heartbeat for at least 2 minutes" });
  });
  it("collapses adjacent throttled short-gap pairs", () => {
    const items = pairViolationEvents([
      { id: "d1", type: "DISCONNECTED", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: false, merged_types: [], meta: { count_reason: "short_gap" } },
      { id: "r1", type: "RECONNECTED", occurred_at: "2026-10-05T10:00:40Z", duration_ms: 40_000, counts: false, merged_types: [], meta: null },
      { id: "d2", type: "DISCONNECTED", occurred_at: "2026-10-05T10:01:00Z", duration_ms: null, counts: false, merged_types: [], meta: { count_reason: "short_gap" } },
      { id: "r2", type: "RECONNECTED", occurred_at: "2026-10-05T10:01:40Z", duration_ms: 40_000, counts: false, merged_types: [], meta: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "d1", grouped_count: 2 });
  });
  it("uses half-threshold amber and threshold red", () => {
    expect(badgeTone(4, 10)).toBe("neutral"); expect(badgeTone(5, 10)).toBe("amber"); expect(badgeTone(10, 10)).toBe("red");
  });
});
