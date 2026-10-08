export type GeminiFailure = { status: number; body?: unknown; finishReason?: string };
export type ErrorAction =
  | { kind: "rpm"; cooldownMs: number }
  | { kind: "daily" }
  | { kind: "disable_key" }
  | { kind: "model_not_found" }
  | { kind: "retry" }
  | { kind: "split" }
  | { kind: "blocked" };

function text(body: unknown): string { return JSON.stringify(body ?? "").toLowerCase(); }

export function classifyGeminiFailure(failure: GeminiFailure, priorRateLimits = 0): ErrorAction {
  const body = text(failure.body);
  if (failure.finishReason === "SAFETY") return { kind: "blocked" };
  if (failure.finishReason === "MAX_TOKENS" || body.includes("json")) return { kind: "split" };
  if (failure.status === 429) {
    if (body.includes("per day") || body.includes("daily")) return { kind: "daily" };
    return { kind: "rpm", cooldownMs: [30_000, 120_000, 600_000][Math.min(priorRateLimits, 2)] };
  }
  if (failure.status === 403 || (failure.status === 400 && (body.includes("api key") || body.includes("api_key") || body.includes("key not valid")))) return { kind: "disable_key" };
  if (failure.status === 404) return { kind: "model_not_found" };
  if (failure.status >= 500) return { kind: "retry" };
  return { kind: "blocked" };
}
