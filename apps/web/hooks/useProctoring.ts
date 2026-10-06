"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureSnapshot } from "@/lib/snapshot";
import {
  EVENT_QUEUE_MAX, EVENT_RETRY_MS, FOCUS_GRACE_MS, INSTANT_DEDUP_MS,
  MEDIA_LOSS_GRACE_MS, MIN_INCIDENT_MS, VIEWPORT_CONFIRM_TICKS,
  VIEWPORT_INTERVAL_MS, VIEWPORT_TOLERANCE, WARNING_TOAST_MS,
  PASTE_NOTICE_MS,
} from "@/lib/proctoring-config";
import { isSnapshotEligible, type ClientEventType } from "@/lib/proctoring-rules";

export type QueuedEvent = {
  id: string; type: ClientEventType; merged_types: ClientEventType[];
  opened_at_ms: number; duration_ms: number | null; meta: Record<string, unknown> | null;
  snapshot_jpeg_base64?: string | null; retries: number;
};

export function capEventQueue(queue: QueuedEvent[]): QueuedEvent[] {
  return queue.length <= EVENT_QUEUE_MAX ? queue : queue.slice(queue.length - EVENT_QUEUE_MAX);
}

type Options = {
  enabled: boolean;
  inProgress: boolean;
  video?: HTMLVideoElement | null;
  mediaTracks?: Array<{ kind: "audio" | "video"; track: MediaStreamTrack; source: "track" | "livekit" }>;
  liveKitDisconnected?: boolean;
  cameraUnavailable?: boolean;
  microphoneUnavailable?: boolean;
  now?: () => number;
};

const storageKey = "proctoringEventQueue";
const systemNow = () => performance.now();
const noMediaTracks: NonNullable<Options["mediaTracks"]> = [];
const episodeTypes = new Set<ClientEventType>(["MULTI_SCREEN", "CAMERA_LOST", "MIC_LOST"]);

export function candidateEventBody(event: QueuedEvent, now: number) {
  return {
    id: event.id,
    type: event.type,
    merged_types: event.merged_types,
    occurred_ago_ms: Math.max(0, Math.round(now - event.opened_at_ms)),
    duration_ms: event.duration_ms === null ? null : Math.max(0, Math.round(event.duration_ms)),
    meta: event.meta,
    snapshot_jpeg_base64: event.snapshot_jpeg_base64 ?? null,
  };
}

export function useProctoring({ enabled, inProgress, video = null, mediaTracks = noMediaTracks, liveKitDisconnected = false, cameraUnavailable = false, microphoneUnavailable = false, now = systemNow }: Options) {
  const [fullscreenLost, setFullscreenLost] = useState(false);
  const [attentionWarning, setAttentionWarning] = useState(false);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const queue = useRef<QueuedEvent[]>([]);
  const active = useRef<QueuedEvent | null>(null);
  const episodes = useRef(new Map<ClientEventType, QueuedEvent>());
  const signals = useRef(new Set<ClientEventType>());
  const sending = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const warningTimer = useRef<number | null>(null);
  const pasteTimer = useRef<number | null>(null);
  const drainRef = useRef<() => Promise<void>>(async () => undefined);
  const lastInstant = useRef(new Map<ClientEventType, number>());
  const mediaLossSources = useRef(new Map<ClientEventType, Set<"track" | "livekit">>());

  const persist = useCallback(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(queue.current)); } catch { /* best effort */ }
  }, []);

  const enqueue = useCallback((event: QueuedEvent) => {
    queue.current = capEventQueue([...queue.current, event]);
    persist();
    queueMicrotask(() => void drainRef.current());
  }, [persist]);

  const snapshot = useCallback((type: ClientEventType) => {
    if (!video || !isSnapshotEligible(type) || document.visibilityState === "hidden") return { image: null, skipped: null };
    const result = captureSnapshot(video);
    return { image: result.base64, skipped: result.skipped };
  }, [video]);

  const openSignal = useCallback((type: ClientEventType, meta: Record<string, unknown> | null = null) => {
    if (episodeTypes.has(type)) {
      const current = episodes.current.get(type);
      if (current) {
        if (current.meta?.source === "livekit" && meta?.source === "track") current.meta = { ...current.meta, source: "track" };
        return;
      }
      const shot = snapshot(type);
      episodes.current.set(type, {
        id: crypto.randomUUID(),
        type,
        merged_types: [],
        opened_at_ms: now(),
        duration_ms: null,
        meta: shot.skipped ? { ...(meta ?? {}), snapshot_skipped: shot.skipped } : meta,
        snapshot_jpeg_base64: shot.image,
        retries: 0,
      });
      return;
    }
    const current = active.current;
    if (current) {
      signals.current.add(type);
      if (type !== current.type && !current.merged_types.includes(type)) current.merged_types.push(type);
      return;
    }
    const shot = type === "TAB_HIDDEN" ? { image: null, skipped: null } : snapshot(type);
    active.current = { id: crypto.randomUUID(), type, merged_types: [], opened_at_ms: now(), duration_ms: null, meta: shot.skipped ? { ...(meta ?? {}), snapshot_skipped: shot.skipped } : meta, snapshot_jpeg_base64: shot.image, retries: 0 };
    signals.current.add(type);
  }, [now, snapshot]);

  const closeSignal = useCallback((type: ClientEventType, force = false) => {
    if (episodeTypes.has(type)) {
      const episode = episodes.current.get(type);
      if (!episode) return;
      episode.duration_ms = Math.max(0, now() - episode.opened_at_ms);
      enqueue(episode);
      episodes.current.delete(type);
      return;
    }
    signals.current.delete(type);
    const current = active.current;
    if (!current || (signals.current.size > 0 && !force)) return;
    current.duration_ms = Math.max(0, now() - current.opened_at_ms);
    if (current.type === "TAB_HIDDEN" && !current.snapshot_jpeg_base64) {
      const shot = snapshot(current.type);
      current.snapshot_jpeg_base64 = shot.image;
      if (shot.skipped) current.meta = { ...(current.meta ?? {}), snapshot_at: "end", snapshot_skipped: shot.skipped };
      else current.meta = { ...(current.meta ?? {}), snapshot_at: "end" };
    }
    const shouldSend = force || current.type === "FULLSCREEN_EXIT" || current.duration_ms >= MIN_INCIDENT_MS || current.merged_types.length > 0;
    if (shouldSend) {
      enqueue(current);
      if (inProgress && [current.type, ...current.merged_types].some((value) => value === "TAB_HIDDEN" || value === "FOCUS_LOST")) {
        setAttentionWarning(true);
        if (warningTimer.current !== null) window.clearTimeout(warningTimer.current);
        warningTimer.current = window.setTimeout(() => setAttentionWarning(false), WARNING_TOAST_MS);
      }
    }
    active.current = null;
    signals.current.clear();
  }, [enqueue, inProgress, now, snapshot]);

  const setMediaLoss = useCallback((type: "CAMERA_LOST" | "MIC_LOST", source: "track" | "livekit", lost: boolean) => {
    const sources = mediaLossSources.current.get(type) ?? new Set<"track" | "livekit">();
    if (lost) {
      sources.add(source);
      mediaLossSources.current.set(type, sources);
      openSignal(type, { source: sources.has("track") ? "track" : "livekit" });
      return;
    }
    sources.delete(source);
    if (sources.size === 0) {
      mediaLossSources.current.delete(type);
      closeSignal(type);
    } else {
      mediaLossSources.current.set(type, sources);
    }
  }, [closeSignal, openSignal]);

  const instant = useCallback((type: ClientEventType, meta: Record<string, unknown> | null = null) => {
    const timestamp = now();
    if (timestamp - (lastInstant.current.get(type) ?? -Infinity) < INSTANT_DEDUP_MS) return;
    lastInstant.current.set(type, timestamp);
    enqueue({ id: crypto.randomUUID(), type, merged_types: [], opened_at_ms: timestamp, duration_ms: null, meta, retries: 0 });
  }, [enqueue, now]);

  const drain = useCallback(async function drainQueue() {
    if (sending.current || queue.current.length === 0) return;
    sending.current = true;
    const event = queue.current[0]!;
    try {
      const response = await fetch("/api/events", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidateEventBody(event, now())),
      });
      if (response.ok || [400, 401, 403].includes(response.status)) queue.current.shift();
      else if (response.status === 429 || response.status >= 500) throw new Error("retry");
      else queue.current.shift();
      persist();
    } catch {
      event.retries += 1;
      persist();
      const delay = EVENT_RETRY_MS[Math.min(event.retries - 1, EVENT_RETRY_MS.length - 1)]!;
      retryTimer.current = window.setTimeout(() => { retryTimer.current = null; void drainQueue(); }, delay);
    } finally { sending.current = false; }
    if (queue.current.length > 0 && retryTimer.current === null) queueMicrotask(() => void drainQueue());
  }, [now, persist]);

  const flush = useCallback(async (timeoutMs = 2_000) => {
    if (active.current) closeSignal(active.current.type, true);
    for (const type of [...episodes.current.keys()]) closeSignal(type, true);
    const deadline = Date.now() + timeoutMs;
    while (queue.current.length > 0 && Date.now() < deadline) { await drain(); await new Promise((resolve) => setTimeout(resolve, 0)); }
  }, [closeSignal, drain]);
  useEffect(() => { drainRef.current = drain; }, [drain]);

  useEffect(() => {
    try { const restored = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as QueuedEvent[]; queue.current = capEventQueue(Array.isArray(restored) ? restored : []); } catch { queue.current = []; }
    if (queue.current.length) void drain();
  }, [drain]);

  useEffect(() => {
    if (!enabled) return;
    const visibility = () => document.visibilityState === "hidden" ? openSignal("TAB_HIDDEN") : closeSignal("TAB_HIDDEN");
    let focusTimer: number | null = null;
    const blur = () => { focusTimer = window.setTimeout(() => { if (!document.hasFocus()) openSignal("FOCUS_LOST"); }, FOCUS_GRACE_MS); };
    const focus = () => { if (focusTimer !== null) window.clearTimeout(focusTimer); closeSignal("FOCUS_LOST"); };
    const fullscreen = () => {
      const lost = !document.fullscreenElement;
      setFullscreenLost(lost);
      if (lost) {
        screen.orientation?.unlock?.();
        openSignal("FULLSCREEN_EXIT");
      } else closeSignal("FULLSCREEN_EXIT", true);
    };
    const block = (event: Event) => {
      event.preventDefault();
      if (event.type === "paste") {
        setPasteBlocked(true);
        if (pasteTimer.current !== null) window.clearTimeout(pasteTimer.current);
        pasteTimer.current = window.setTimeout(() => setPasteBlocked(false), PASTE_NOTICE_MS);
      }
      instant(event.type === "copy" ? "COPY" : event.type === "paste" ? "PASTE" : "CONTEXT_MENU");
    };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", blur); window.addEventListener("focus", focus); document.addEventListener("fullscreenchange", fullscreen);
    document.addEventListener("copy", block); document.addEventListener("paste", block); document.addEventListener("contextmenu", block);
    fullscreen();
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", blur); window.removeEventListener("focus", focus); document.removeEventListener("fullscreenchange", fullscreen); document.removeEventListener("copy", block); document.removeEventListener("paste", block); document.removeEventListener("contextmenu", block); };
  }, [closeSignal, enabled, instant, openSignal]);

  useEffect(() => {
    if (!enabled) return;
    let failures = 0;
    const interval = window.setInterval(() => {
      if (!document.fullscreenElement) { failures = 0; return; }
      if (window.innerWidth < screen.width * VIEWPORT_TOLERANCE) failures += 1; else failures = 0;
      if (failures >= VIEWPORT_CONFIRM_TICKS) openSignal("VIEWPORT_CHANGED", { width: window.innerWidth, screen_width: screen.width });
      else if (failures === 0) closeSignal("VIEWPORT_CHANGED");
      const extended = "isExtended" in screen && Boolean((screen as Screen & { isExtended?: boolean }).isExtended);
      if (extended) openSignal("MULTI_SCREEN"); else closeSignal("MULTI_SCREEN");
    }, VIEWPORT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [closeSignal, enabled, openSignal]);

  useEffect(() => {
    if (!enabled) return;
    const cleanups = mediaTracks.map(({ kind, track, source }) => {
      let timer: number | null = null;
      const type = kind === "video" ? "CAMERA_LOST" : "MIC_LOST";
      const lost = () => { if (timer === null) timer = window.setTimeout(() => { timer = null; setMediaLoss(type, source, true); }, MEDIA_LOSS_GRACE_MS); };
      const restored = () => { if (timer !== null) window.clearTimeout(timer); timer = null; setMediaLoss(type, source, false); };
      track.addEventListener("mute", lost); track.addEventListener("ended", lost); track.addEventListener("unmute", restored);
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        track.removeEventListener("mute", lost);
        track.removeEventListener("ended", lost);
        track.removeEventListener("unmute", restored);
        setMediaLoss(type, source, false);
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [enabled, mediaTracks, setMediaLoss]);

  useEffect(() => {
    if (!enabled) return;
    setMediaLoss("CAMERA_LOST", "livekit", liveKitDisconnected);
    setMediaLoss("MIC_LOST", "livekit", liveKitDisconnected);
    return () => {
      setMediaLoss("CAMERA_LOST", "livekit", false);
      setMediaLoss("MIC_LOST", "livekit", false);
    };
  }, [enabled, liveKitDisconnected, setMediaLoss]);

  useEffect(() => {
    if (!enabled) return;
    setMediaLoss("CAMERA_LOST", "track", cameraUnavailable);
    setMediaLoss("MIC_LOST", "track", microphoneUnavailable);
    return () => {
      setMediaLoss("CAMERA_LOST", "track", false);
      setMediaLoss("MIC_LOST", "track", false);
    };
  }, [cameraUnavailable, enabled, microphoneUnavailable, setMediaLoss]);

  useEffect(() => { if (enabled && inProgress) instant("RELOAD"); }, [enabled, inProgress, instant]);
  useEffect(() => {
    if (enabled) return;
    if (active.current) closeSignal(active.current.type, true);
    for (const type of [...episodes.current.keys()]) closeSignal(type, true);
  }, [closeSignal, enabled]);
  useEffect(() => {
    const pagehide = () => {
      if (active.current) closeSignal(active.current.type, true);
      for (const type of [...episodes.current.keys()]) closeSignal(type, true);
      const event = queue.current[0]; if (!event) return;
      navigator.sendBeacon?.("/api/events", new Blob([JSON.stringify(candidateEventBody(event, now()))], { type: "application/json" }));
    };
    window.addEventListener("pagehide", pagehide); return () => window.removeEventListener("pagehide", pagehide);
  }, [closeSignal, now]);
  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    if (warningTimer.current !== null) window.clearTimeout(warningTimer.current);
    if (pasteTimer.current !== null) window.clearTimeout(pasteTimer.current);
  }, []);

  return {
    fullscreenLost,
    attentionWarning,
    pasteBlocked,
    dismissAttentionWarning: () => setAttentionWarning(false),
    flush,
    sendInstant: instant,
    pendingCount: () => queue.current.length,
  };
}
