import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { safeGradingLogDetail, safeWorkerSlots } from "./admin-data";

describe("safeGradingLogDetail", () => {
  it("keeps structured counts and drops free text", () => {
    expect(safeGradingLogDetail("items=10,latency_ms=220")).toBe("items=10,latency_ms=220");
    expect(safeGradingLogDetail("candidate said secret words")).toBeNull();
  });
});

describe("safeWorkerSlots", () => {
  it("keeps three independently reported limits", () => {
    const detail = JSON.stringify({ slots: ["key1", "key2", "key3"].map((key) => ({ key, used: 0, limit: 100 })) });
    expect(safeWorkerSlots(detail)).toEqual([
      { key: "key1", used: 0, limit: 100 }, { key: "key2", used: 0, limit: 100 }, { key: "key3", used: 0, limit: 100 },
    ]);
  });
});
