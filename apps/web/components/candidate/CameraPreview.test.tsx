// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraPreview } from "./CameraPreview";

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(cleanup);

describe("CameraPreview", () => {
  it.each([
    ["waiting", "h-[120px]", "w-[160px]"],
    ["exam", "h-[72px]", "w-[96px]"],
  ] as const)("is mirrored, named and non-zero in %s mode", (mode, height, width) => {
    render(<CameraPreview stream={null} mode={mode} />);
    const video = screen.getByLabelText("Your camera preview");
    expect(video.className).toContain("scale-x-[-1]");
    expect(video.className).toContain(height);
    expect(video.className).toContain(width);
    expect(video.className).not.toMatch(/\bhidden\b|display-none/);
    expect(video.getAttribute("style") ?? "").not.toContain("display: none");
  });

  it("attaches the shared stream and starts playback", () => {
    const mediaStream = {} as MediaStream;
    render(<CameraPreview stream={mediaStream} mode="waiting" />);
    const video = screen.getByLabelText("Your camera preview") as HTMLVideoElement;
    expect(video.srcObject).toBe(mediaStream);
    expect(video.play).toHaveBeenCalledTimes(1);
  });
});
