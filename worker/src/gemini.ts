import { z } from "zod";
import { GRADING_MODEL } from "../../apps/web/lib/grading/contracts";
import { SYSTEM_INSTRUCTION } from "./prompt";

export type GeminiCall = { key: string; user: string; timeoutMs: number; thinking?: string; fetcher?: typeof fetch };
export type GeminiResult = { ok: true; text: string; latencyMs: number; finishReason?: string } | { ok: false; status: number; body: unknown; latencyMs: number; finishReason?: string };

const response = z.object({ candidates: z.array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string() })) }).optional(), finishReason: z.string().optional() })).min(1) });

export async function callGemini(input: GeminiCall): Promise<GeminiResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const result = await (input.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${GRADING_MODEL}:generateContent`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": input.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json",
          ...(input.thinking ? { thinkingConfig: { thinkingLevel: input.thinking } } : {}),
          responseSchema: { type: "ARRAY", items: { type: "OBJECT", required: ["item", "candidate_meaning_english", "matched_points", "missing_points", "incorrect_claims", "marks", "verdict", "reason", "confidence", "language"], propertyOrdering: ["item", "candidate_meaning_english", "matched_points", "missing_points", "incorrect_claims", "marks", "verdict", "reason", "confidence", "language"], properties: { item: { type: "STRING" }, candidate_meaning_english: { type: "STRING" }, matched_points: { type: "ARRAY", items: { type: "STRING" } }, missing_points: { type: "ARRAY", items: { type: "STRING" } }, incorrect_claims: { type: "ARRAY", items: { type: "STRING" } }, marks: { type: "NUMBER" }, verdict: { type: "STRING", enum: ["correct", "partially_correct", "incorrect", "no_answer"] }, reason: { type: "STRING" }, confidence: { type: "NUMBER" }, language: { type: "STRING", enum: ["english", "sinhala", "mixed", "singlish"] } } } },
        },
      }),
    });
    const body: unknown = await result.json().catch(() => null);
    const latencyMs = Math.round(performance.now() - started);
    if (!result.ok) return { ok: false, status: result.status, body, latencyMs };
    const parsed = response.safeParse(body);
    if (!parsed.success) return { ok: false, status: result.status, body: null, latencyMs, finishReason: "INVALID_RESPONSE" };
    const candidate = parsed.data.candidates[0];
    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "MAX_TOKENS" || !candidate.content) return { ok: false, status: result.status, body: null, latencyMs, finishReason: candidate.finishReason };
    return { ok: true, text: candidate.content.parts.map((part) => part.text).join(""), latencyMs, finishReason: candidate.finishReason };
  } finally { clearTimeout(timer); }
}
