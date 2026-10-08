import type { GradingConfig } from "./config";
import { callGemini } from "./gemini";

export type DryRunStore = { log(row: Record<string, unknown>): Promise<void> };
export async function runDryRun(config: GradingConfig, store: DryRunStore, fetcher: typeof fetch = fetch): Promise<{ label: string; ok: boolean }[]> {
  const output = [];
  for (const slot of config.keys) {
    const started = performance.now(); let ok: boolean;
    try { const result = await callGemini({ key: slot.key, user: JSON.stringify({ items: [{ item: "1", question: "Return zero", candidate_answer: "", model_answer: "", max_marks: 1 }] }), timeoutMs: config.requestTimeoutMs, thinking: config.thinking, fetcher }); ok = result.ok; }
    catch { ok = false; }
    await store.log({ run_id: null, key_label: slot.label, model: config.model, event: "call", detail: `items=1,latency_ms=${Math.round(performance.now() - started)}` });
    output.push({ label: slot.label, ok });
  }
  return output;
}
