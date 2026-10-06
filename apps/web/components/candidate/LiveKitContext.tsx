"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { CameraPreview, type CameraPreviewMode } from "@/components/candidate/CameraPreview";
import { type CandidateMediaTrack, type CandidateMediaStatus, useLiveKit } from "@/hooks/useLiveKit";

type CandidateLiveKitValue = {
  status: CandidateMediaStatus;
  stream: MediaStream | null;
  mediaTracks: CandidateMediaTrack[];
  previewElement: HTMLVideoElement | null;
  cameraLost: boolean;
  microphoneLost: boolean;
  connectionLost: boolean;
  acquireAndConnect(): Promise<boolean>;
  stop(): Promise<void>;
};

const inertValue: CandidateLiveKitValue = {
  status: "idle",
  stream: null,
  mediaTracks: [],
  previewElement: null,
  cameraLost: false,
  microphoneLost: false,
  connectionLost: false,
  acquireAndConnect: async () => false,
  stop: async () => undefined,
};

const CandidateLiveKitContext = createContext<CandidateLiveKitValue>(inertValue);

function previewMode(pathname: string): CameraPreviewMode | null {
  if (pathname === "/check") return "check";
  if (pathname === "/waiting") return "waiting";
  if (pathname === "/exam") return "exam";
  return null;
}

export function CandidateLiveKitProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const liveKit = useLiveKit();
  const [previewElement, setPreviewElement] = useState<HTMLVideoElement | null>(null);
  const setPreview = useCallback((element: HTMLVideoElement | null) => setPreviewElement(element), []);
  const mode = previewMode(pathname);
  const { stream, trySilentReacquire } = liveKit;

  useEffect(() => {
    if ((pathname === "/waiting" || pathname === "/exam") && !stream) {
      void trySilentReacquire();
    }
  }, [pathname, stream, trySilentReacquire]);

  const value = useMemo<CandidateLiveKitValue>(() => ({
    status: liveKit.status,
    stream: liveKit.stream,
    mediaTracks: liveKit.mediaTracks,
    previewElement,
    cameraLost: liveKit.cameraLost,
    microphoneLost: liveKit.microphoneLost,
    connectionLost: liveKit.connectionLost,
    acquireAndConnect: liveKit.acquireAndConnect,
    stop: liveKit.stop,
  }), [liveKit, previewElement]);

  return (
    <CandidateLiveKitContext.Provider value={value}>
      {children}
      {mode ? (
        <div className={pathname === "/check" ? "mx-auto mt-6 w-fit" : "fixed bottom-24 right-4 z-20"}>
          <CameraPreview stream={liveKit.stream} mode={mode} onElement={setPreview} />
        </div>
      ) : null}
    </CandidateLiveKitContext.Provider>
  );
}

export function useCandidateLiveKit(): CandidateLiveKitValue {
  return useContext(CandidateLiveKitContext);
}
