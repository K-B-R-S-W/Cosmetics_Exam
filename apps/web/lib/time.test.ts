// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { correctedNowMs, formatCountdown, median, syncServerClock } from "./time";

afterEach(() => vi.restoreAllMocks());

describe("server time", () => {
  it("keeps the median of 3 to 5 midpoint samples", async () => {
    const clock = vi.spyOn(Date, "now");
    const times = [1000, 1100, 2000, 2100, 3000, 3100];
    clock.mockImplementation(() => times.shift() ?? 3100);
    const replies = [1200, 5000, 3200];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ server_time_ms: replies.shift() }), { status: 200 }));
    expect(await syncServerClock(3, fetcher as typeof fetch)).toBe(150);
    expect(correctedNowMs(4000)).toBe(4150);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it.each([[90_000, "1:30"], [3_661_000, "1:01:01"], [-100, "0:00"]])("formats %s without going negative", (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
