import { describe, expect, it } from "vitest";
import { ATTENTION_TYPES, COUNTING_TYPES, isSnapshotEligible } from "./proctoring-rules";

describe("proctoring rules", () => {
  it("keeps clipboard events informational and reload counting", () => {
    expect(COUNTING_TYPES.has("COPY")).toBe(false);
    expect(COUNTING_TYPES.has("PASTE")).toBe(false);
    expect(COUNTING_TYPES.has("CONTEXT_MENU")).toBe(false);
    expect(COUNTING_TYPES.has("RELOAD")).toBe(true);
  });

  it("limits snapshots and attention reversal to eligible types", () => {
    expect(isSnapshotEligible("TAB_HIDDEN")).toBe(true);
    expect(isSnapshotEligible("CAMERA_LOST")).toBe(false);
    expect(ATTENTION_TYPES.has("VIEWPORT_CHANGED")).toBe(true);
    expect(ATTENTION_TYPES.has("MULTI_SCREEN")).toBe(false);
  });
});
