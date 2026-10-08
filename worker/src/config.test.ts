import { describe, expect, it } from "vitest";

import { PROCTORING_INTERVAL_MS, SCHEDULER_EARLY_WINDOW_MS, SCHEDULER_INTERVAL_MS, loadWorkerConfig } from "./config";

describe("worker config", () => {
  it("uses the approved scheduler cadence and conservative scan window", () => {
    expect(SCHEDULER_INTERVAL_MS).toBe(10_000);
    expect(PROCTORING_INTERVAL_MS).toBe(30_000);
    expect(SCHEDULER_EARLY_WINDOW_MS).toBe(60_000);
  });

  it("accepts the scheduler's complete environment", () => {
    expect(loadWorkerConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
      GEMINI_MODEL: "gemini-3.7-flash",
      GEMINI_KEY_1: "synthetic-key",
      GEMINI_DAILY_LIMITS: "key1:20",
    })).toMatchObject({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "synthetic-service-key",
      grading: { model: "gemini-3.7-flash", chunkSize: 10 },
    });
  });

  it("keeps each configured daily limit by its exact key label", () => {
    const config = loadWorkerConfig({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
      GEMINI_MODEL: "gemini-3.7-flash",
      GEMINI_KEY_1: "one", GEMINI_KEY_2: "two", GEMINI_KEY_3: "three",
      GEMINI_DAILY_LIMITS: "key1:100,key2:100,key3:100",
    });
    expect(config.grading.keys.map(({ label, dailyLimit }) => ({ label, dailyLimit }))).toEqual([
      { label: "key1", dailyLimit: 100 }, { label: "key2", dailyLimit: 100 }, { label: "key3", dailyLimit: 100 },
    ]);
  });

  it("fails closed when either secret is missing", () => {
    expect(() => loadWorkerConfig({ SUPABASE_URL: "https://example.supabase.co" })).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(() => loadWorkerConfig({ SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" })).toThrow(
      "SUPABASE_URL",
    );
  });

  it("fails closed on a different model or an unbounded key", () => {
    const base = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" };
    expect(() => loadWorkerConfig({ ...base, GEMINI_MODEL: "other", GEMINI_KEY_1: "key", GEMINI_DAILY_LIMITS: "key1:10" }))
      .toThrow("gemini-3.7-flash");
    expect(() => loadWorkerConfig({ ...base, GEMINI_MODEL: "gemini-3.7-flash", GEMINI_KEY_1: "key", GEMINI_DAILY_LIMITS: "key1:0" }))
      .toThrow("positive daily limit");
  });

  it("validates the approved chunk range", () => {
    const base = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", GEMINI_MODEL: "gemini-3.7-flash", GEMINI_KEY_1: "key", GEMINI_DAILY_LIMITS: "key1:10" };
    expect(loadWorkerConfig({ ...base, GRADING_CHUNK_SIZE: "1" }).grading.chunkSize).toBe(1);
    expect(() => loadWorkerConfig({ ...base, GRADING_CHUNK_SIZE: "11" })).toThrow("GRADING_CHUNK_SIZE");
  });
});
