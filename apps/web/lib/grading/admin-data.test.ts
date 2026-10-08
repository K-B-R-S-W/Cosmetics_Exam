import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { safeGradingLogDetail } from "./admin-data";

describe("safeGradingLogDetail", () => {
  it("keeps structured counts and drops free text", () => {
    expect(safeGradingLogDetail("items=10,latency_ms=220")).toBe("items=10,latency_ms=220");
    expect(safeGradingLogDetail("candidate said secret words")).toBeNull();
  });
});
