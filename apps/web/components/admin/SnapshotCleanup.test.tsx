// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SnapshotCleanup } from "./SnapshotCleanup";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const exams = {
  items: [
    { id: "00000000-0000-4000-8000-000000000001", title: "Ended exam", status: "ended" },
    { id: "00000000-0000-4000-8000-000000000002", title: "Live exam", status: "live" },
  ],
};

describe("SnapshotCleanup", () => {
  it("never starts a purge automatically and uses Check then confirm then Delete", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/exams") return new Response(JSON.stringify(exams), { status: 200 });
      const body = JSON.parse(String(init?.body));
      if (body.dry_run) return new Response(JSON.stringify({ eligible: 3, deleted: 0, failed: 0, remaining: 3, dry_run: true }), { status: 200 });
      return new Response(JSON.stringify({ eligible: 3, deleted: 2, failed: 0, remaining: 1, dry_run: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<SnapshotCleanup />);

    await screen.findByRole("option", { name: "Ended exam" });
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/admin/snapshots/purge")).toHaveLength(0);
    expect(screen.queryByRole("option", { name: "Live exam" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Exam"), { target: { value: exams.items[0]!.id } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("3 snapshots would be deleted.")).toBeTruthy();
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ exam_id: exams.items[0]!.id, dry_run: true });

    fireEvent.click(screen.getByRole("button", { name: "Delete snapshots" }));
    const dialog = screen.getByRole("dialog", { name: "Delete 3 snapshots?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete snapshots" }));
    await screen.findByText("Deleted 2 snapshots. 0 failed.");
    expect(screen.getByText("Run again to continue.")).toBeTruthy();
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ exam_id: exams.items[0]!.id, dry_run: false, confirm: true });
  });

  it("does not offer a caller-selected retention or zero-day delete-all control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));
    render(<SnapshotCleanup />);
    await waitFor(() => expect(screen.getByText("Snapshots are also deleted automatically after 14 days.")).toBeTruthy());
    expect(screen.queryByLabelText(/days/i)).toBeNull();
    expect(screen.queryByText(/delete all/i)).toBeNull();
  });

  it("disables cleanup after the server reports it unavailable", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "service_unavailable", message: "Snapshot cleanup is unavailable." } }), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    render(<SnapshotCleanup />);
    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Snapshot cleanup is unavailable.");
    expect((screen.getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
