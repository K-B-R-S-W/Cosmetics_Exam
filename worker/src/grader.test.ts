import { expect, it, vi } from "vitest";
import { insertScoreRowsIdempotently } from "./grader";

it("falls back per score after a crash-retry duplicate", async () => {
  const insert = vi.fn()
    .mockResolvedValueOnce({ error: { code: "23505" } })
    .mockResolvedValueOnce({ error: { code: "23505" } })
    .mockResolvedValueOnce({ error: null });
  await expect(insertScoreRowsIdempotently(insert, [{ id: "one" }, { id: "two" }])).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledTimes(3);
});
