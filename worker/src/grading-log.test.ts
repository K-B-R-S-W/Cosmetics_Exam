import { expect, it } from "vitest";
import { safeGradingDetail, validateGradingLog } from "./grading-log";

it("allows labels and counts but rejects key material", () => {
  expect(safeGradingDetail({ items: 2, latency_ms: 4 })).toBe("items=2,latency_ms=4");
  expect(() => validateGradingLog({ run_id: null, event: "call", key_label: "AIza-secret" })).toThrow();
  expect(() => validateGradingLog({ run_id: null, event: "call", detail: "candidate answer text" })).toThrow();
});
