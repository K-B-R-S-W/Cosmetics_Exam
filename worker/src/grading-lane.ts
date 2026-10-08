import { GRADING_ACTIVE_INTERVAL_MS, GRADING_IDLE_INTERVAL_MS } from "./config";

export type GradingLane = { stop(): void; tickNow(): Promise<void> };

type GradingLaneOptions = { onError?: (code: string) => void; now?: () => number };

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.message === "database_error") return "database_error";
  return "grading_tick_failed";
}

export function startGradingLane(tick: () => Promise<{ active: boolean }>, options: GradingLaneOptions = {}): GradingLane {
  let stopped = false;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const lastErrorAt = new Map<string, number>();
  const schedule = (delay: number) => { if (!stopped) timer = setTimeout(() => void run(), delay); };
  const run = () => {
    if (stopped || running) return running ?? Promise.resolve();
    running = tick().then((result) => { schedule(result.active ? GRADING_ACTIVE_INTERVAL_MS : GRADING_IDLE_INTERVAL_MS); })
      .catch((error: unknown) => {
        const code = safeErrorCode(error);
        const now = (options.now ?? Date.now)();
        const previous = lastErrorAt.get(code);
        if (previous === undefined || now - previous >= 60_000) {
          lastErrorAt.set(code, now);
          options.onError?.(code);
        }
        schedule(GRADING_IDLE_INTERVAL_MS);
      }).finally(() => { running = null; });
    return running;
  };
  void run();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); }, tickNow: run };
}
