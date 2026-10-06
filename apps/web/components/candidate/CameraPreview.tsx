"use client";

import { useEffect, useRef } from "react";

export type CameraPreviewMode = "check" | "waiting" | "exam";

const sizeClasses: Record<CameraPreviewMode, string> = {
  check: "h-[240px] w-[320px]",
  waiting: "h-[120px] w-[160px]",
  exam: "h-[72px] w-[96px]",
};

export function CameraPreview({
  stream,
  mode,
  onElement,
}: {
  stream: MediaStream | null;
  mode: CameraPreviewMode;
  onElement?(element: HTMLVideoElement | null): void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    onElement?.(video);
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => onElement?.(null);
  }, [onElement, stream]);

  return (
    <video
      ref={ref}
      aria-label="Your camera preview"
      autoPlay
      muted
      playsInline
      className={`${sizeClasses[mode]} shrink-0 scale-x-[-1] rounded-control border border-line bg-ink object-cover`}
    />
  );
}
