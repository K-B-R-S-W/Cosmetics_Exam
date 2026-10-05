"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ApiErrorPayload, StateBody } from "@/lib/candidate-types";

const HEARTBEAT_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export function useHeartbeat(
  onState: (state: StateBody) => void,
  onAuthError: (code: "unauthenticated" | "session_revoked") => void,
  enabled = true,
) {
  const callbacks = useRef({ onState, onAuthError });
  const flight = useRef<Promise<StateBody | null> | null>(null);
  const stopped = useRef(false);
  useEffect(() => { callbacks.current = { onState, onAuthError }; }, [onState, onAuthError]);

  const heartbeatNow = useCallback(() => {
    if (!enabled || stopped.current) return Promise.resolve(null);
    if (!flight.current) {
      const request = (async () => {
        const response = await fetch("/api/heartbeat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const body = await response.json().catch(() => null) as StateBody | ApiErrorPayload | null;
        if (!response.ok) {
          const code = body && "error" in body ? body.error.code : "internal_error";
          if (code === "unauthenticated" || code === "session_revoked") {
            stopped.current = true;
            callbacks.current.onAuthError(code);
          }
          throw new Error(code);
        }
        callbacks.current.onState(body as StateBody);
        return body as StateBody;
      })();
      const settled = request.finally(() => { if (flight.current === settled) flight.current = null; });
      flight.current = settled;
    }
    return flight.current;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      stopped.current = false;
      return;
    }
    stopped.current = false;
    let active = true; let timer: number | null = null; let failures = 0;
    const schedule = (delay: number) => { timer = window.setTimeout(async () => {
      try { await heartbeatNow(); failures = 0; } catch { failures += 1; }
      if (active && !stopped.current) schedule(failures === 0 ? HEARTBEAT_MS : Math.min(HEARTBEAT_MS * 2 ** failures, MAX_BACKOFF_MS));
    }, delay); };
    schedule(HEARTBEAT_MS);
    return () => { active = false; if (timer !== null) window.clearTimeout(timer); };
  }, [enabled, heartbeatNow]);

  return heartbeatNow;
}
