import sharp, { type Metadata, type Sharp } from "sharp";

import { ApiError } from "@/lib/api";
import {
  QUESTION_IMAGE_LONG_EDGE,
  QUESTION_IMAGE_MAX_BYTES,
  QUESTION_IMAGE_MAX_PIXELS,
} from "@/lib/questions";

export interface ProcessedQuestionImage {
  buffer: Buffer;
  mime: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

const formatDetails = {
  jpeg: { mime: "image/jpeg" as const, extension: "jpg" as const },
  png: { mime: "image/png" as const, extension: "png" as const },
  webp: { mime: "image/webp" as const, extension: "webp" as const },
};

function signatureFormat(buffer: Buffer): keyof typeof formatDetails | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function invalidImage(message = "Choose a valid JPEG, PNG or WebP image."): ApiError {
  return new ApiError("invalid_image", 400, message);
}

export async function processQuestionImage(input: Buffer, declaredMime: string): Promise<ProcessedQuestionImage> {
  if (input.length < 1 || input.length > QUESTION_IMAGE_MAX_BYTES) throw invalidImage("The image must be 4 MiB or smaller.");
  const signature = signatureFormat(input);
  if (!signature || formatDetails[signature].mime !== declaredMime) throw invalidImage("The file type does not match its contents.");

  let source: Sharp;
  let metadata: Metadata;
  try {
    source = sharp(input, { animated: true, failOn: "error", limitInputPixels: QUESTION_IMAGE_MAX_PIXELS });
    metadata = await source.metadata();
  } catch {
    throw invalidImage();
  }
  if (metadata.format !== signature) throw invalidImage("The file type does not match its contents.");
  if ((metadata.pages ?? 1) > 1) throw invalidImage("Animated images are not allowed.");
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > QUESTION_IMAGE_MAX_PIXELS) {
    throw invalidImage("The image dimensions are too large.");
  }

  let pipeline = sharp(input, { animated: false, failOn: "error", limitInputPixels: QUESTION_IMAGE_MAX_PIXELS })
    .rotate()
    .resize({ width: QUESTION_IMAGE_LONG_EDGE, height: QUESTION_IMAGE_LONG_EDGE, fit: "inside", withoutEnlargement: true });
  if (signature === "jpeg") pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  if (signature === "png") pipeline = pipeline.png({ compressionLevel: 9 });
  if (signature === "webp") pipeline = pipeline.webp({ quality: 85 });

  let output: Buffer;
  let outputMetadata: Metadata;
  try {
    output = await pipeline.toBuffer();
    outputMetadata = await sharp(output, { limitInputPixels: QUESTION_IMAGE_MAX_PIXELS }).metadata();
  } catch {
    throw invalidImage();
  }
  if (output.length > QUESTION_IMAGE_MAX_BYTES || !outputMetadata.width || !outputMetadata.height) {
    throw invalidImage("The processed image is too large.");
  }
  return {
    buffer: output,
    mime: formatDetails[signature].mime,
    extension: formatDetails[signature].extension,
    width: outputMetadata.width,
    height: outputMetadata.height,
  };
}
