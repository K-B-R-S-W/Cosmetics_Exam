// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViolationTimeline } from "./ViolationTimeline";
afterEach(() => vi.unstubAllGlobals());
describe("ViolationTimeline", () => {
  it("shows paired gap reasons and dismisses with a note", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
    render(<ViolationTimeline events={[{ id: "d", type: "DISCONNECTED", occurred_at: "2026-10-05T10:00:00Z", duration_ms: null, counts: true, merged_types: [], meta: { count_reason: "long_gap" } }, { id: "r", type: "RECONNECTED", occurred_at: "2026-10-05T10:03:00Z", duration_ms: 180000, counts: false, merged_types: [], meta: null }]} />);
    expect(screen.getByText("Gap: 180 seconds")).toBeTruthy(); fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Synthetic review" } }); fireEvent.click(screen.getByRole("button", { name: "Dismiss incident" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/admin/events/d", expect.objectContaining({ body: JSON.stringify({ dismissed: true, note: "Synthetic review" }) })));
  });
});
