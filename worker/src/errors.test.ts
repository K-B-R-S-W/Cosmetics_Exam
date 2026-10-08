import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyGeminiFailure } from "./errors";

it("distinguishes RPM and daily 429s", () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8"));
  const rpm = fixture("gemini-429-rpm.synthetic.json"); const daily = fixture("gemini-429-daily.synthetic.json");
  expect(rpm.synthetic).toBe(true); expect(daily.synthetic).toBe(true);
  expect(classifyGeminiFailure({ status: 429, body: rpm })).toEqual({ kind: "rpm", cooldownMs: 30_000 });
  expect(classifyGeminiFailure({ status: 429, body: rpm }, 1)).toEqual({ kind: "rpm", cooldownMs: 120_000 });
  expect(classifyGeminiFailure({ status: 429, body: rpm }, 2)).toEqual({ kind: "rpm", cooldownMs: 600_000 });
  expect(classifyGeminiFailure({ status: 429, body: daily })).toEqual({ kind: "daily" });
});

it("does not disable a key for an unrelated bad request", () => {
  expect(classifyGeminiFailure({ status: 400, body: { error: { message: "Invalid response schema" } } })).toEqual({ kind: "blocked" });
  expect(classifyGeminiFailure({ status: 400, body: { error: { message: "API key not valid" } } })).toEqual({ kind: "disable_key" });
});
