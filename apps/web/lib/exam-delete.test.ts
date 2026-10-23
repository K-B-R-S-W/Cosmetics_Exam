import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { loadExamStoragePaths, removeExamStorage } from "./exam-delete";

vi.mock("server-only", () => ({}));

describe("exam deletion storage", () => {
  it("captures every exact image and snapshot path across database pages", async () => {
    const images = Array.from({ length: 1_001 }, (_, index) => ({ image_path: `admin/q-${index}.jpg` }));
    const snapshots = [{ snapshot_path: "snapshots/exam/attempt/event.jpg" }];
    const from = vi.fn((table: string) => {
      const rows = table === "questions" ? images : snapshots;
      const chain = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain), not: vi.fn(() => chain),
        range: vi.fn(async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null })),
      };
      return chain;
    });
    const client = { from } as unknown as SupabaseClient;
    const result = await loadExamStoragePaths(client, "exam-id");
    expect(result.questionImages).toHaveLength(1_001);
    expect(result.questionImages.at(-1)).toBe("admin/q-1000.jpg");
    expect(result.snapshots).toEqual(["snapshots/exam/attempt/event.jpg"]);
  });

  it("removes exact paths from their correct buckets in bounded batches", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const from = vi.fn(() => ({ remove, exists: vi.fn() }));
    const client = { storage: { from } } as unknown as SupabaseClient;
    const images = Array.from({ length: 101 }, (_, index) => `admin/q-${index}.jpg`);
    const snapshots = ["snapshots/exam/attempt/event.jpg"];
    expect(await removeExamStorage(client, { questionImages: images, snapshots })).toBe(0);
    expect(from).toHaveBeenCalledWith("question-images");
    expect(from).toHaveBeenCalledWith("snapshots");
    expect(remove).toHaveBeenCalledWith(images.slice(0, 100));
    expect(remove).toHaveBeenCalledWith(images.slice(100));
    expect(remove).toHaveBeenCalledWith(snapshots);
  });

  it("checks failed batches and reports only objects that remain", async () => {
    const client = {
      storage: { from: () => ({
        remove: async () => ({ data: null, error: { message: "synthetic" } }),
        exists: async (path: string) => path === "b" ? { data: false, error: null } : { data: true, error: null },
      }) },
    } as unknown as SupabaseClient;
    expect(await removeExamStorage(client, { questionImages: ["a", "b"], snapshots: ["c"] })).toBe(2);
  });
});
