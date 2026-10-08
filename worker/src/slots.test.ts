import { expect, it } from "vitest";
import { SlotManager } from "./slots";

it("skips exhausted slots", () => {
  const slots = new SlotManager([{ label: "key1", key: "secret", dailyLimit: 2 }], 1, 0);
  expect(slots.available(1)?.label).toBe("key1");
  slots.markCall("key1", 1);
  expect(slots.available(2)).toBeNull();
});

it("leases one in-flight job per slot", () => {
  const slots = new SlotManager([{ label: "key1", key: "one", dailyLimit: 10 }, { label: "key2", key: "two", dailyLimit: 10 }], 0, 0);
  expect(slots.acquire(1)?.label).toBe("key1"); expect(slots.acquire(1)?.label).toBe("key2"); expect(slots.acquire(1)).toBeNull();
  slots.release("key1"); expect(slots.acquire(1)?.label).toBe("key1");
});

it("tracks consecutive rate limits and resets them after a successful call", () => {
  const slots = new SlotManager([{ label: "key1", key: "one", dailyLimit: 10 }], 0, 0);
  expect(slots.recordRateLimit("key1")).toBe(0); expect(slots.recordRateLimit("key1")).toBe(1);
  slots.markCall("key1", 1); expect(slots.recordRateLimit("key1")).toBe(0);
});

it("can hold a retry for its prior slot and later exclude that slot", () => {
  const slots = new SlotManager([{ label: "key1", key: "one", dailyLimit: 10 }, { label: "key2", key: "two", dailyLimit: 10 }], 0, 0);
  expect(slots.acquire(1, "key2")?.label).toBe("key2"); slots.release("key2");
  expect(slots.acquire(1, undefined, "key2")?.label).toBe("key1");
});
