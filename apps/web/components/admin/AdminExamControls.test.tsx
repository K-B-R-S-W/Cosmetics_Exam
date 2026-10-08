// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminExamControls } from "./AdminExamControls";

const exam = { id: "e", title: "Exam", status: "live" as const, navigation_mode: "free" as const, scheduled_start_at: null, started_at: null, ends_at: new Date(Date.now() + 60_000).toISOString(), force_ended_at: null, duration_min: 45, flag_threshold: 10 };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("AdminExamControls", () => {
  it("refetches before offering retry after a non-idempotent 503", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Audit failed." } }), { status: 503 })));
    render(<AdminExamControls exam={exam} onChanged={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Extend time" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Extend time" })[1]!);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole("alert").textContent).toContain("Audit failed");
  });
  it("puts focus on the safe force-end button", () => {
    render(<AdminExamControls exam={exam} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "End exam" }));
    expect(screen.getByRole("button", { name: "Keep exam running" })).toBe(document.activeElement);
  });
  it("shows the estimated Gemini calls returned by grade start", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ estimated_calls: 7 }), { status: 202 })));
    render(<AdminExamControls exam={{ ...exam, status: "finalized" }} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start grading" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Start grading" })[1]!);
    expect(await screen.findByText(/Estimated Gemini calls: 7/u)).toBeTruthy();
  });
});
