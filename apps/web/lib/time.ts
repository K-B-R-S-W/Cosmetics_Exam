"use client";

import { useCallback, useEffect, useState } from "react";

let serverOffsetMs = 0;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export async function syncServerClock(
  samples = 3,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!Number.isInteger(samples) || samples < 3 || samples > 5) {
    throw new Error("Clock sync requires 3 to 5 samples");
  }
  const offsets: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const sentAt = Date.now();
    const response = await fetcher("/api/time", { cache: "no-store" });
    const receivedAt = Date.now();
    if (!response.ok) throw new Error("clock_sync_failed");
    const body = (await response.json()) as { server_time_ms: number };
    offsets.push(body.server_time_ms - (sentAt + receivedAt) / 2);
  }
  serverOffsetMs = median(offsets);
  return serverOffsetMs;
}

export function refineServerClock(serverTime: string, receivedAt = Date.now()): void {
  const candidate = new Date(serverTime).getTime() - receivedAt;
  if (Number.isFinite(candidate)) serverOffsetMs = candidate;
}

export function correctedNowMs(localNow = Date.now()): number {
  return localNow + serverOffsetMs;
}

export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function useServerClock(): () => number {
  const [, rerender] = useState(0);
  useEffect(() => {
    let active = true;
    const sync = () => void syncServerClock().then(() => active && rerender((value) => value + 1)).catch(() => null);
    sync();
    const syncTimer = window.setInterval(sync, 60_000);
    const tickTimer = window.setInterval(() => rerender((value) => value + 1), 1000);
    return () => { active = false; window.clearInterval(syncTimer); window.clearInterval(tickTimer); };
  }, []);
  return useCallback(() => correctedNowMs(), []);
}
