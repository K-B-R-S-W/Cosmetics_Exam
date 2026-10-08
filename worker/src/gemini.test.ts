import { expect, it, vi } from "vitest";
import { callGemini } from "./gemini";

it("puts the key in a header and pins the model", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }));
  await callGemini({ key: "secret", user: "{}", timeoutMs: 1_000, fetcher });
  expect(fetcher.mock.calls[0][0]).toContain("gemini-3.7-flash");
  expect(fetcher.mock.calls[0][0]).not.toContain("secret");
  expect(fetcher.mock.calls[0][1].headers["x-goog-api-key"]).toBe("secret");
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.generationConfig.responseSchema).toMatchObject({ type: "ARRAY", items: { required: expect.arrayContaining(["item", "marks", "candidate_meaning_english"]) } });
});

it("passes through the optional thinking level only when configured", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }), { status: 200 }));
  await callGemini({ key: "secret", user: "{}", timeoutMs: 1_000, thinking: "LOW", fetcher });
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
});

it("returns a typed model failure for an empty HTTP 200 response", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
  await expect(callGemini({ key: "secret", user: "{}", timeoutMs: 1_000, fetcher })).resolves.toMatchObject({ ok: false, status: 200, finishReason: "INVALID_RESPONSE" });
});
