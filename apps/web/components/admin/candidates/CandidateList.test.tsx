// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateList } from "./CandidateList";
import { ToastProvider } from "@/components/ui/Toast";

const fetchMock = vi.fn();
const candidate = {
  id: "00000000-0000-4000-8000-000000000002",
  mer_code: "TEST-001",
  full_name: "Synthetic Candidate",
  outlet: "Training Outlet",
  active: true,
  created_at: "2026-10-04T00:00:00.000Z",
  assigned_exam_count: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("CandidateList", () => {
  function renderList() {
    return render(<ToastProvider><CandidateList /></ToastProvider>);
  }

  async function renderCandidate() {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [candidate], total: 1, exam_options: [] }));
    renderList();
    await screen.findByText(candidate.full_name);
  }

  it("opens a confirmation dialog from the candidate row", async () => {
    await renderCandidate();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByText("Remove TEST-001?").closest("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("cancels removal without making a request", async () => {
    await renderCandidate();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText(candidate.full_name)).toBeTruthy();
  });

  it("removes the row after a successful DELETE", async () => {
    await renderCandidate();
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));

    await waitFor(() => expect(screen.queryByText(candidate.full_name)).toBeNull());
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/admin/candidates/${candidate.id}`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("offers Mark inactive after has_attempts and keeps the row", async () => {
    await renderCandidate();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "has_attempts", message: "This candidate has taken part in an exam. Mark them inactive instead." } }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));

    expect(await screen.findByRole("button", { name: "Mark inactive" })).toBeTruthy();
    expect(screen.getByText(candidate.full_name)).toBeTruthy();
  });

  it("marks a blocked candidate inactive only after confirmation", async () => {
    await renderCandidate();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "has_attempts", message: "Mark them inactive instead." } }, 409))
      .mockResolvedValueOnce(jsonResponse({ candidate: { ...candidate, active: false } }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));

    fireEvent.click(await screen.findByRole("button", { name: "Mark inactive" }));

    await within(screen.getByTestId("toast-container")).findByText("TEST-001 marked inactive.");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
    expect(screen.getByText(candidate.full_name)).toBeTruthy();
  });

  it("keeps the row when the remove request fails", async () => {
    await renderCandidate();
    fetchMock.mockRejectedValueOnce(new Error("Synthetic network failure"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic network failure")).toBeTruthy();
    expect(screen.queryByText("Synthetic network failure", { selector: "section > p[role='alert']" })).toBeNull();
    expect(screen.getByText(candidate.full_name)).toBeTruthy();
  });

  it("shows unlock failures as persistent toasts", async () => {
    await renderCandidate();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Synthetic unlock failure." } }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Unlock login" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic unlock failure.")).toBeTruthy();
    expect(screen.queryByText("Synthetic unlock failure.", { selector: "section > p[role='alert']" })).toBeNull();
  });

  it("shows mark-inactive failures as persistent toasts", async () => {
    await renderCandidate();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: "has_attempts", message: "Mark them inactive instead." } }, 409))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Synthetic inactive failure." } }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove candidate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark inactive" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic inactive failure.")).toBeTruthy();
    expect(screen.getByText("Mark them inactive instead.")).toBeTruthy();
  });

  it("loads exam options only on the first request and unlocks a candidate", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              mer_code: "TEST-001",
              full_name: "නිර්මාණ පරීක්ෂක",
              outlet: "පුහුණු ශාඛාව",
              active: true,
              created_at: "2026-10-04T00:00:00.000Z",
              assigned_exam_count: 0,
            },
          ],
          total: 1,
          exam_options: [
            { id: "exam-1", title: "Synthetic Exam", status: "draft" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ cleared: 2 }));

    renderList();

    expect(await screen.findByText("නිර්මාණ පරීක්ෂක")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "include=exam_options",
    );
    expect(screen.getByRole("option", { name: "Synthetic Exam" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unlock login" }));
    expect(
      await within(screen.getByTestId("toast-container")).findByText("Cleared 2 failed login attempts for TEST-001."),
    ).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "all" },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).not.toContain(
      "include=exam_options",
    );
  });
});
