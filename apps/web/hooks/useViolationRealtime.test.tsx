// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { onlyLastSeenChanged } from "./useViolationRealtime";
describe("useViolationRealtime filtering", () => {
  it("ignores only last_seen_at and retains material attempt updates", () => {
    expect(onlyLastSeenChanged({ id: "a", violation_count: 1, last_seen_at: "one" }, { id: "a", violation_count: 1, last_seen_at: "two" })).toBe(true);
    expect(onlyLastSeenChanged({ id: "a", violation_count: 1, last_seen_at: "one" }, { id: "a", violation_count: 2, last_seen_at: "two" })).toBe(false);
  });
});
