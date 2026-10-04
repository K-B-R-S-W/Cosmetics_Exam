import { beforeEach, describe, expect, it, vi } from "vitest";

import { removeQuestionImageWithRetry, verifyQuestionImage } from "@/lib/question-server";

vi.mock("server-only", () => ({}));

const image = {
  path: "questions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000105.jpg",
  alt_text: "Synthetic",
  mime: "image/jpeg" as const,
  size_bytes: 123,
};

describe("question image Storage checks", () => {
  const info = vi.fn();
  const remove = vi.fn();
  const neq = vi.fn();
  const query = { neq };
  const limit = vi.fn(() => query);
  const eq = vi.fn(() => ({ limit }));
  const client = {
    storage: { from: () => ({ info, remove }) },
    from: () => ({ select: () => ({ eq }) }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    info.mockResolvedValue({ data: { size: 123, contentType: "image/jpeg" }, error: null });
    neq.mockResolvedValue({ data: [], error: null });
  });

  it("requires Storage MIME and size to match all submitted metadata", async () => {
    await expect(verifyQuestionImage(client as never, image, "00000000-0000-4000-8000-000000000101")).resolves.toBeUndefined();
    expect(neq).toHaveBeenCalledWith("id", "00000000-0000-4000-8000-000000000101");
    info.mockResolvedValue({ data: { size: 124, contentType: "image/jpeg" }, error: null });
    await expect(verifyQuestionImage(client as never, image)).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects an object already attached to another question", async () => {
    neq.mockResolvedValue({ data: [{ id: "other" }], error: null });
    await expect(verifyQuestionImage(client as never, image, "00000000-0000-4000-8000-000000000101")).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("retries a failed object removal once", async () => {
    remove.mockResolvedValueOnce({ error: { message: "temporary" } }).mockResolvedValueOnce({ error: null });
    await expect(removeQuestionImageWithRetry(client as never, image.path, "admin-1")).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
