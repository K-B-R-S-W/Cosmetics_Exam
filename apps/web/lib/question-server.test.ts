import { beforeEach, describe, expect, it, vi } from "vitest";

import { addPreviewUrls, removeQuestionImageWithRetry, verifyQuestionImage } from "@/lib/question-server";

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
  const createSignedUrls = vi.fn();
  const neq = vi.fn();
  const query = { neq };
  const limit = vi.fn(() => query);
  const eq = vi.fn(() => ({ limit }));
  const client = {
    storage: { from: () => ({ info, remove, createSignedUrls }) },
    from: () => ({ select: () => ({ eq }) }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    info.mockResolvedValue({ data: { size: 123, contentType: "image/jpeg" }, error: null });
    createSignedUrls.mockResolvedValue({ data: [], error: null });
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

  it("signs all image previews in one batch and marks missing objects", async () => {
    const secondImage = { ...image, path: image.path.replace("105", "106") };
    createSignedUrls.mockResolvedValue({
      data: [
        { path: image.path, signedUrl: "https://signed.example/one", error: null },
        { path: secondImage.path, signedUrl: null, error: "Object not found" },
      ],
      error: null,
    });
    const base = { id: "q", exam_id: "e", position: 0, type: "written" as const, body_html: "Q", marks: 1, options: [], answer_key: { correct_option_id: null, model_answer: null, grading_notes: null, calibration: [] } };
    const items = await addPreviewUrls(client as never, [{ ...base, image }, { ...base, id: "q2", image: secondImage }]);
    expect(createSignedUrls).toHaveBeenCalledOnce();
    expect(createSignedUrls).toHaveBeenCalledWith([image.path, secondImage.path], 300);
    expect(items[0]!.image).toMatchObject({ preview_url: "https://signed.example/one" });
    expect(items[1]!.image).toMatchObject({ image_missing: true });
  });

  it("marks every image missing when the batch signing request fails", async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    const item = { id: "q", exam_id: "e", position: 0, type: "written" as const, body_html: "Q", marks: 1, image, options: [], answer_key: { correct_option_id: null, model_answer: null, grading_notes: null, calibration: [] } };
    await expect(addPreviewUrls(client as never, [item])).resolves.toEqual([
      expect.objectContaining({ image: expect.objectContaining({ image_missing: true }) }),
    ]);
  });
});
