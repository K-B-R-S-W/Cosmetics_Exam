import { expect, it, vi } from "vitest";
import { checkKeys } from "./key-check";
import { DEFAULT_GRADING_TUNING } from "./config";

it("labels a rejected key without exposing it", async () => {
  const update = vi.fn(); const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
  await checkKeys({ ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash", keys: [{ label: "key1", key: "secret", dailyLimit: 1 }], reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1_000 }, update, fetcher);
  expect(update).toHaveBeenCalledWith("key1", "disabled");
});

it("isolates one failed key check and continues checking later labels", async () => {
  const update = vi.fn(); const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(null, { status: 200 }));
  const keys = [{ label: "key1", key: "secret-one", dailyLimit: 1 }, { label: "key2", key: "secret-two", dailyLimit: 1 }];
  await checkKeys({ ...DEFAULT_GRADING_TUNING, model: "gemini-3.7-flash", keys, reserve: 0, slotMinIntervalMs: 0, requestTimeoutMs: 1_000 }, update, fetcher);
  expect(update).toHaveBeenCalledOnce(); expect(update).toHaveBeenCalledWith("key2", "active");
});
