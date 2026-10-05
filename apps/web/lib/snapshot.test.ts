import { describe, expect, it, vi } from "vitest";
import { captureSnapshot } from "./snapshot";

function canvas(brightness: number) {
  const data = new Uint8ClampedArray(320 * 240 * 4).fill(brightness);
  return { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), getImageData: () => ({ data }) }), toDataURL: () => "data:image/jpeg;base64,/9j/synthetic/9k=" } as unknown as HTMLCanvasElement;
}
describe("snapshot", () => {
  it("skips unavailable and black frames", () => {
    expect(captureSnapshot({ readyState: 0, videoWidth: 0, videoHeight: 0 } as never).skipped).toBe("unavailable");
    expect(captureSnapshot({ readyState: 2, videoWidth: 640, videoHeight: 480 } as never, () => canvas(0)).skipped).toBe("black");
  });
  it("returns a 320x240 JPEG base64 payload", () => {
    const target = canvas(100);
    expect(captureSnapshot({ readyState: 2, videoWidth: 640, videoHeight: 480 } as never, () => target)).toEqual({ base64: "/9j/synthetic/9k=", skipped: null });
    expect(target.width).toBe(320); expect(target.height).toBe(240);
  });
});
