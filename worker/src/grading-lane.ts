import { GRADING_ACTIVE_INTERVAL_MS, GRADING_IDLE_INTERVAL_MS } from "./config";

export type GradingLane = { stop(): void; tickNow(): Promise<void> };

export function startGradingLane(tick: () => Promise<{ active: boolean }>): GradingLane {
  let stopped = false;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (delay: number) => { if (!stopped) timer = setTimeout(() => void run(), delay); };
  const run = () => {
    if (stopped || running) return running ?? Promise.resolve();
    running = tick().then((result) => { schedule(result.active ? GRADING_ACTIVE_INTERVAL_MS : GRADING_IDLE_INTERVAL_MS); })
      .catch(() => { schedule(GRADING_IDLE_INTERVAL_MS); }).finally(() => { running = null; });
    return running;
  };
  void run();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); }, tickNow: run };
}
