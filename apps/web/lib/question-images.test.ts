import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { processQuestionImage } from "@/lib/question-images";

vi.mock("server-only", () => ({}));

async function fixture(format: "jpeg" | "png" | "webp", width = 32, height = 24): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 4, background: { r: 30, g: 80, b: 130, alpha: 1 } } });
  return format === "jpeg" ? image.jpeg().toBuffer() : format === "png" ? image.png().toBuffer() : image.webp().toBuffer();
}

describe("question image processing", () => {
  it("rejects a truncated image fixture", async () => {
    const jpeg = await fixture("jpeg");
    await expect(processQuestionImage(jpeg.subarray(0, 24), "image/jpeg")).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects a MIME-spoofed fixture", async () => {
    await expect(processQuestionImage(await fixture("png"), "image/jpeg")).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects animated GIF and animated WebP fixtures", async () => {
    const animatedGif = Buffer.from("R0lGODlhAgACAPAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAICRAEAIfkEAAAAAAAsAAAAAAIAAgAAAgJEADs=", "base64");
    await expect(processQuestionImage(animatedGif, "image/gif")).rejects.toMatchObject({ code: "invalid_image" });

    const animatedWebp = await sharp(animatedGif, { animated: true })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    await expect(processQuestionImage(animatedWebp, "image/webp")).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects an image over the 25 MP decoded-pixel ceiling", async () => {
    const bomb = await fixture("png", 5_001, 5_000);
    await expect(processQuestionImage(bomb, "image/png")).rejects.toMatchObject({ code: "invalid_image" });
  }, 20_000);

  it("strips EXIF metadata and orientation", async () => {
    const source = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "Synthetic fixture" } } })
      .toBuffer();
    const result = await processQuestionImage(source, "image/jpeg");
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("scales the long edge to 1600 and reports the processed bytes", async () => {
    const result = await processQuestionImage(await fixture("jpeg", 2_000, 1_000), "image/jpeg");
    const metadata = await sharp(result.buffer).metadata();
    expect([metadata.width, metadata.height]).toEqual([1_600, 800]);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mime).toBe("image/jpeg");
  });
});
