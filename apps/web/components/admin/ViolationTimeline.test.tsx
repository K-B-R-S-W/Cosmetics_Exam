// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViolationTimeline } from "./ViolationTimeline";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("ViolationTimeline", () => {
  it("shows paired gap reasons and dismisses with a note", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
    render(<ViolationTimeline events={[{ id: "d", type: "DISCONNECTED", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: true, merged_types: [], meta: { count_reason: "long_gap" } }, { id: "r", type: "RECONNECTED", occurred_at: "2026-10-05T10:03:00Z", duration_ms: 180000, counts: false, merged_types: [], meta: null }]} />);
    expect(screen.getByText("Gap: 180 seconds")).toBeTruthy(); fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Synthetic review" } }); fireEvent.click(screen.getByRole("button", { name: "Dismiss incident" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/events/d", expect.objectContaining({ body: JSON.stringify({ dismissed: true, note: "Synthetic review" }) })));
  });
  it("requests a fresh signed URL before opening a snapshot", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "event-1", snapshot_url: "https://example.test/fresh.jpg" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<ViolationTimeline events={[{ id: "event-1", type: "FOCUS_LOST", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: true, merged_types: [], meta: null, snapshot_url: "https://example.test/thumb.jpg" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open snapshot for FOCUS LOST" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/events/event-1", { cache: "no-store" }));
    expect(await screen.findByRole("dialog", { name: "Incident snapshot" })).toBeTruthy();
  });
  it("shows durable cleanup markers without offering a missing snapshot", () => {
    render(<ViolationTimeline events={[
      { id: "queued", type: "FOCUS_LOST", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: true, merged_types: [], meta: { snapshot_purge_queued_at: "2026-10-20T10:00:00Z" } },
      { id: "deleted", type: "TAB_HIDDEN", occurred_at: "2026-10-05T10:01:00Z", duration_ms: null, counts: true, merged_types: [], meta: { snapshot_deleted_at: "2026-10-20T10:01:00Z" } },
    ]} />);
    expect(screen.getByText("Snapshot cleanup pending")).toBeTruthy();
    expect(screen.getByText("Snapshot deleted after 14-day retention")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open snapshot/ })).toBeNull();
  });
});
