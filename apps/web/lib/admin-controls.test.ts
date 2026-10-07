import { describe, expect, it } from "vitest";
import { broadcastSchema, confirmSchema, extendExamSchema, uniqueIds } from "./admin-controls";

describe("admin control contracts", () => {
  it("requires literal confirmation", () => { expect(confirmSchema.safeParse({ confirm: false }).success).toBe(false); expect(confirmSchema.parse({ confirm: true })).toEqual({ confirm: true }); });
  it("caps extensions", () => { expect(extendExamSchema.safeParse({ minutes: 0 }).success).toBe(false); expect(extendExamSchema.safeParse({ minutes: 120 }).success).toBe(true); });
  it("keeps announcement audiences strict", () => {
    expect(broadcastSchema.safeParse({ message: "Hi", audience: "all", duration: 5 }).success).toBe(false);
    expect(broadcastSchema.safeParse({ message: "Hi", audience: "custom" }).success).toBe(false);
    expect(uniqueIds(["a", "a", "b"])).toEqual(["a", "b"]);
  });
});
