import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { runDatabaseSmoke, WORKER_READ_PROBES } from "./db-smoke";

it("runs every worker probe as a read-only limited select", async () => {
  const operations: string[] = [];
  const builder = {
    select: vi.fn(() => { operations.push("select"); return builder; }),
    limit: vi.fn(() => { operations.push("limit"); return builder; }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  const client = { from: vi.fn(() => { operations.push("from"); return builder; }) } as unknown as SupabaseClient;
  const lines: string[] = [];
  await expect(runDatabaseSmoke(client, (line) => lines.push(line))).resolves.toBe(true);
  expect(lines).toHaveLength(WORKER_READ_PROBES.length);
  expect(lines.every((line) => line.endsWith(": OK"))).toBe(true);
  expect(operations).toEqual(WORKER_READ_PROBES.flatMap(() => ["from", "select", "limit"]));
});

it("prints only the PostgREST error code", async () => {
  const builder = {
    select: vi.fn(() => builder), limit: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { code: "PGRST200", message: "secret row text" } }).then(resolve),
  };
  const lines: string[] = [];
  await expect(runDatabaseSmoke({ from: vi.fn(() => builder) } as unknown as SupabaseClient, (line) => lines.push(line))).resolves.toBe(false);
  expect(lines.every((line) => line.endsWith("ERROR PGRST200"))).toBe(true);
  expect(lines.join(" ")).not.toContain("secret row text");
});
