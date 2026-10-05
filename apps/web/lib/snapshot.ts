import { BLACK_LUMA, SNAPSHOT_HEIGHT, SNAPSHOT_QUALITY, SNAPSHOT_WIDTH } from "./proctoring-config";

export type SnapshotResult = { base64: string | null; skipped: "black" | "unavailable" | null };

export function captureSnapshot(
  video: Pick<HTMLVideoElement, "readyState" | "videoWidth" | "videoHeight"> & CanvasImageSource,
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): SnapshotResult {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return { base64: null, skipped: "unavailable" };
  const canvas = createCanvas();
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = SNAPSHOT_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { base64: null, skipped: "unavailable" };
  context.drawImage(video, 0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT);
  const pixels = context.getImageData(0, 0, SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT).data;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4) luminance += (pixels[index]! + pixels[index + 1]! + pixels[index + 2]!) / 3;
  if (luminance / (pixels.length / 4) < BLACK_LUMA) return { base64: null, skipped: "black" };
  return { base64: canvas.toDataURL("image/jpeg", SNAPSHOT_QUALITY).split(",", 2)[1] ?? null, skipped: null };
}
