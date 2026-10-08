import { describe, expect, it } from "vitest";
import { documentedRpcDetails, gradeStartSchema, gradingRpcStatus } from "./contracts";

describe("grading contracts", () => {
  it("caps chunks at ten and is strict", () => {
    expect(gradeStartSchema.safeParse({ chunk_size: 10, extra: true }).success).toBe(false);
    expect(gradeStartSchema.safeParse({ chunk_size: 11 }).success).toBe(false);
  });
  it("only exposes documented database details", () => {
    expect(gradingRpcStatus("regrade_in_progress")).toBe(409);
    expect(documentedRpcDetails("grading_in_progress", "00000000-0000-4000-8000-000000000001"))
      .toEqual({ run_id: "00000000-0000-4000-8000-000000000001" });
    expect(documentedRpcDetails("internal", "secret database text")).toBeNull();
  });
});
