"use client";

import { useEffect, useRef, useState } from "react";

import type { SaveIndicatorState } from "@/hooks/useAutosave";

// Removed from the indicator in Batch 3B; retained until Commit C enables the controls that use this tooltip.
export const BATCH_THREE_NOTE = "Answers are not saved yet (Phase 2 batch 3)";

function savedTime(savedAt: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(savedAt));
}

export function SaveIndicator({ state = { kind: "waiting", durable: true, savedAt: null } }: { state?: SaveIndicatorState }) {
  const previous = useRef<SaveIndicatorState["kind"] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const content = {
    waiting: { icon: "●", words: "Waiting to save", warning: false },
    saving: { icon: "●", words: "Saving…", warning: false },
    saved: { icon: "✓", words: state.savedAt ? `Saved ${savedTime(state.savedAt)}` : "Saved", warning: false },
    offline: {
      icon: "⚠",
      words: state.durable
        ? "Offline. Answers are kept on this device. Reconnect to save them."
        : "Offline. Keep this window open. Reconnect to save your answers.",
      warning: true,
    },
    retrying: { icon: "◌", words: "Reconnecting…", warning: true },
    failed: { icon: "⚠", words: "Could not save this answer. Tell the exam team.", warning: true },
  }[state.kind];
  const spins = state.kind === "saving" || state.kind === "retrying";
  useEffect(() => {
    const wasProblem = previous.current === "offline" || previous.current === "retrying" || previous.current === "failed";
    const isProblem = state.kind === "offline" || state.kind === "retrying" || state.kind === "failed";
    if (isProblem || (state.kind === "saved" && wasProblem)) setAnnouncement(content.words);
    else setAnnouncement("");
    previous.current = state.kind;
  }, [content.words, state.kind]);
  return <><p data-testid="save-indicator" className={`text-sm ${content.warning ? "text-warn" : "text-muted"}`}><span aria-hidden="true" className={spins ? "inline-block motion-safe:animate-spin" : undefined}>{content.icon}</span> {content.words}</p><p role="status" aria-live="polite" className="sr-only">{announcement}</p></>;
}
