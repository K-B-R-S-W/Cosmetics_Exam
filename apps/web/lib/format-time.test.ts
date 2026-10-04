import { describe, expect, it } from "vitest";
import { formatColombo } from "./format-time";

describe("formatColombo", () => {
  it("always formats in Asia/Colombo", () => {
    expect(formatColombo("2026-10-05T04:30:00.000Z")).toBe("Mon 5 Oct, 10:00 am");
  });
});
