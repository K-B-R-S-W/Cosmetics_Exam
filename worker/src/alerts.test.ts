import { expect, it, vi } from "vitest";
import { createGradingAlert } from "./alerts";

it("treats the active-alert unique race as idempotent", async () => {
  const insert = vi.fn().mockResolvedValue({ error: { code: "23505" } });
  await expect(createGradingAlert({ from: () => ({ insert }) }, { type: "grading", severity: "critical", message: "Keys unavailable", uniqueKey: "keys_exhausted:run" })).resolves.toBe("exists");
});
