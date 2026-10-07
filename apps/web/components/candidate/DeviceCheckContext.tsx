"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type WakeLockSentinelLike = { released?: boolean; release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };

type DeviceCheckValue = {
  wakeLockActive: boolean;
  requestWakeLock(): Promise<boolean>;
  releaseDeviceCheck(): Promise<void>;
};

const inert: DeviceCheckValue = { wakeLockActive: false, requestWakeLock: async () => false, releaseDeviceCheck: async () => undefined };
const DeviceCheckContext = createContext<DeviceCheckValue>(inert);

export function DeviceCheckProvider({ children }: { children: ReactNode }) {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);
  const wanted = useRef(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const requestWakeLock = useCallback(async () => {
    wanted.current = true;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return false;
    try {
      if (!sentinel.current || sentinel.current.released) sentinel.current = await wakeLock.request("screen");
      setWakeLockActive(true);
      return true;
    } catch {
      setWakeLockActive(false);
      return false;
    }
  }, []);

  const releaseDeviceCheck = useCallback(async () => {
    wanted.current = false;
    const current = sentinel.current;
    sentinel.current = null;
    setWakeLockActive(false);
    if (current && !current.released) await current.release().catch(() => undefined);
  }, []);

  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible" && wanted.current) void requestWakeLock();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [requestWakeLock]);

  const value = useMemo(() => ({ wakeLockActive, requestWakeLock, releaseDeviceCheck }), [releaseDeviceCheck, requestWakeLock, wakeLockActive]);
  return <DeviceCheckContext.Provider value={value}>{children}</DeviceCheckContext.Provider>;
}

export function useDeviceCheck(): DeviceCheckValue { return useContext(DeviceCheckContext); }
