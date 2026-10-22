// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { CandidateActions } from "./CandidateActions";

const attempt = {
  id: "attempt-1",
  status: "in_progress" as const,
  current_position: 0,
  extra_minutes: 0,
  last_seen_at: "2026-10-22T03:00:00Z",
  violation_count: 0,
  submitted_at: null,
  candidate: {
    id: "candidate-1",
    mer_code: "TEST-001",
    full_name: "Synthetic Candidate",
    outlet: null,
  },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderActions(onChanged = vi.fn()) {
  render(<ToastProvider><CandidateActions attempt={attempt} examId="exam-1" onChanged={onChanged} /></ToastProvider>);
  return onChanged;
}

describe("CandidateActions", () => {
  it("shows a success toast and refreshes after extending time", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const onChanged = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Extend time for this candidate" }));

    fireEvent.click(screen.getByRole("button", { name: "Extend time" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Added 10 minutes.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/exams/exam-1/extend",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ minutes: 10, attempt_id: attempt.id }) }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it("shows a persistent error toast when an action fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Synthetic action failure." } }), { status: 400 }));
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Submit exam for this candidate" }));

    fireEvent.click(screen.getByRole("button", { name: "Submit their exam" }));

    const alert = await within(screen.getByTestId("toast-container")).findByRole("alert");
    expect(alert.textContent).toContain("Synthetic action failure.");
  });
});
