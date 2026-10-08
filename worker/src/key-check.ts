import type { GradingConfig } from "./config";

export async function checkKeys(config: GradingConfig, update: (label: string, status: "active" | "disabled") => Promise<void>, fetcher: typeof fetch = fetch): Promise<void> {
  await Promise.all(config.keys.map(async (slot) => {
    try {
      const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models", { signal: AbortSignal.timeout(config.requestTimeoutMs), headers: { "x-goog-api-key": slot.key } });
      await update(slot.label, response.status === 400 || response.status === 403 ? "disabled" : "active");
    } catch { /* keep the last known state; grading and the remaining keys continue */ }
  }));
}
