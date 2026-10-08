import { expect, it, vi } from "vitest";
import { runDryRun } from "./dry-run";
import { DEFAULT_GRADING_TUNING } from "./config";

it("calls once per key and logs labels only", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
  const log = vi.fn();
  await runDryRun({ ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash", keys: [{ label: "key1", key: "secret", dailyLimit: 2 }], reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1000 }, { log }, fetcher);
  expect(fetcher).toHaveBeenCalledOnce(); expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
