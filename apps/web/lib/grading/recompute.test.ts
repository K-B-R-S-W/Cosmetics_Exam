import { expect, it, vi } from "vitest";
import { recomputeResults } from "./recompute";

it("uses the authoritative recompute RPC", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { total_marks: 2 }, error: null });
  await expect(recomputeResults({ rpc }, "attempt")).resolves.toEqual({ total_marks: 2 });
  expect(rpc).toHaveBeenCalledWith("recompute_results", { p_attempt_id: "attempt" });
});
