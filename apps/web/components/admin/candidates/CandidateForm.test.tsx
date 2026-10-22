// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateForm } from "./CandidateForm";
import { ToastProvider } from "@/components/ui/Toast";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

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
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateForm", () => {
  function renderForm(candidateId: string | null = null) {
    return render(<ToastProvider><CandidateForm candidateId={candidateId} /></ToastProvider>);
  }

  it("explains that the trailing V is optional for 9-digit IDs", () => {
    renderForm();

    expect(screen.getByText(/trailing V is optional/i)).toBeTruthy();
  });

  it("omits a blank ID when editing so the old hash is retained", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          candidate: {
            id: "00000000-0000-4000-8000-000000000002",
            mer_code: "TEST-001",
            full_name: "Synthetic Candidate",
            outlet: "Training Outlet",
            active: true,
            created_at: "2026-10-04T00:00:00.000Z",
            assigned_exam_count: 0,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ candidate: {} }));

    renderForm(candidate.id);

    const name = await screen.findByLabelText("Full name");
    fireEvent.change(name, { target: { value: "සංස්කරණ පරීක්ෂක" } });
    expect((screen.getByLabelText("ID number") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(request.method).toBe("PATCH");
    expect(body.full_name).toBe("සංස්කරණ පරීක්ෂක");
    expect(body).not.toHaveProperty("nic");
    expect(mocks.push).toHaveBeenCalledWith("/admin/candidates");
  });

  it("keeps field-level API validation inline", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "validation_failed",
        message: "Check the highlighted fields.",
        details: [{ path: "full_name", message: "Enter a full name." }],
      },
    }, 400));
    renderForm();
    fireEvent.change(screen.getByLabelText("MER code"), { target: { value: "TEST-001" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Candidate" } });
    fireEvent.change(screen.getByLabelText("ID number"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a full name.")).toBeTruthy();
    expect(screen.getByText("Check the highlighted fields.")).toBeTruthy();
    expect(within(screen.getByTestId("toast-container")).queryByText("Check the highlighted fields.")).toBeNull();
  });

  it("shows non-validation save failures as persistent toasts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "Synthetic save failure." } }, 500));
    renderForm();
    fireEvent.change(screen.getByLabelText("MER code"), { target: { value: "TEST-001" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Candidate" } });
    fireEvent.change(screen.getByLabelText("ID number"), { target: { value: "123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic save failure.")).toBeTruthy();
  });

  it("shows deactivate failures as persistent toasts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ candidate: { ...candidate, assigned_exam_count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Synthetic deactivate failure." } }, 500));
    renderForm(candidate.id);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate candidate" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic deactivate failure.")).toBeTruthy();
  });

  it("shows delete failures as persistent toasts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ candidate }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Synthetic delete failure." } }, 500));
    renderForm(candidate.id);
    fireEvent.click(await screen.findByRole("button", { name: "Delete candidate" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete candidate" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic delete failure.")).toBeTruthy();
  });
});
