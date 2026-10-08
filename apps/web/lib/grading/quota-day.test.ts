import { describe, expect, it } from "vitest";
import { pacificQuotaWindow } from "./quota-day";

describe("pacificQuotaWindow", () => {
  it("handles the November DST day", () => {
    const window = pacificQuotaWindow(new Date("2026-11-01T12:00:00Z"));
    expect(window.start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(window.next.toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });
});
