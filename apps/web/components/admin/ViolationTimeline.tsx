"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  pairViolationEvents,
  type ViolationEvent,
} from "@/lib/violation-events";

export function ViolationTimeline({
  events,
  onChanged,
}: {
  events: ViolationEvent[];
  onChanged?: () => void;
}) {
  const items = useMemo(() => pairViolationEvents(events), [events]);
  const [reviewing, setReviewing] = useState<string>();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [snapshot, setSnapshot] = useState<{ alt: string; url: string }>();
  const [snapshotError, setSnapshotError] = useState<string>();

  async function openSnapshot(id: string, type: string) {
    setSnapshotError(undefined);
    const response = await fetch(`/api/admin/events/${id}`, { cache: "no-store" });
    if (!response.ok) {
      setSnapshotError("The snapshot could not be loaded.");
      return;
    }
    const body = await response.json() as { id: string; snapshot_url: string | null };
    if (!body.snapshot_url) {
      setSnapshotError("The snapshot is no longer available.");
      return;
    }
    setSnapshot({ url: body.snapshot_url, alt: `Snapshot for ${type.replaceAll("_", " ")}` });
  }

  async function review(id: string, dismissed: boolean) {
    if (!note.trim()) {
      setError("Add a review note.");
      return;
    }
    const response = await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed, note: note.trim() }),
    });
    if (!response.ok) {
      setError("The incident could not be updated.");
      return;
    }
    setReviewing(undefined);
    setNote("");
    setError(undefined);
    onChanged?.();
  }

  return (
    <>
    <ol className="space-y-4" aria-label="Violation timeline">
      {items.map((item) => {
        const dismissed = Boolean(item.meta?.dismissed);
        const snapshotMarker = item.meta?.snapshot_deleted_at
          ? "Snapshot deleted after 14-day retention"
          : item.meta?.snapshot_purge_queued_at
            ? "Snapshot cleanup pending"
            : null;
        return (
          <li key={item.id} className="border border-hairline bg-surface p-4">
            <div className="flex justify-between gap-4">
              <strong>{item.type.replaceAll("_", " ")}</strong>
              <time dateTime={item.occurred_at}>
                {new Date(item.occurred_at).toLocaleString("en-LK", {
                  timeZone: "Asia/Colombo",
                })}
              </time>
            </div>
            {item.merged_types.length ? (
              <p className="mt-2 text-sm text-muted">
                Also: {item.merged_types.join(", ")}
              </p>
            ) : null}
            {item.reason ? <p className="mt-2">{item.reason}</p> : null}
            <p className="mt-2 text-sm text-muted">Counted: {item.counts ? "Yes" : "No"}{item.grouped_count ? ` · ×${item.grouped_count}` : ""}</p>
            {item.gap_duration_ms ? (
              <p className="mt-2 text-sm text-muted">
                Gap: {Math.round(item.gap_duration_ms / 1000)} seconds
              </p>
            ) : null}
            {item.snapshot_url ? (
              <button type="button" className="mt-3" aria-label={`Open snapshot for ${item.type.replaceAll("_", " ")}`} onClick={() => void openSnapshot(item.id, item.type)}>
                <Image unoptimized className="h-12 w-16 object-cover" src={item.snapshot_url} width={64} height={48} alt="" />
              </button>
            ) : null}
            {snapshotMarker ? <p className="mt-3 text-sm text-muted">{snapshotMarker}</p> : null}
            {item.counts || dismissed ? (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => {
                  setReviewing(item.id);
                  setNote("");
                }}
              >
                {dismissed ? "Restore" : "Dismiss"}
              </Button>
            ) : null}
            {reviewing === item.id ? (
              <div className="mt-3">
                <label className="font-bold">
                  Review note
                  <textarea
                    className="mt-2 block w-full rounded-control border border-line p-3 font-normal"
                    maxLength={300}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                {error ? (
                  <p role="alert" className="mt-2 text-alert">
                    {error}
                  </p>
                ) : null}
                <Button
                  className="mt-3"
                  onClick={() => void review(item.id, !dismissed)}
                >
                  {dismissed ? "Restore incident" : "Dismiss incident"}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
    {snapshotError ? <p role="alert" className="text-alert">{snapshotError}</p> : null}
    {snapshot ? <div role="dialog" aria-modal="true" aria-label="Incident snapshot" className="fixed inset-0 z-50 grid place-items-center bg-ink/75 p-6"><div className="max-w-3xl bg-surface p-4"><Button variant="secondary" onClick={() => setSnapshot(undefined)}>Close</Button><Image unoptimized className="mt-4 h-auto max-h-[75vh] w-auto" src={snapshot.url} width={1280} height={960} alt={snapshot.alt} /></div></div> : null}
    </>
  );
}
