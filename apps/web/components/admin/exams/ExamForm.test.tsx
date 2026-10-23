// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamForm } from "./ExamForm";
import { ToastProvider } from "@/components/ui/Toast";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const fetchMock = vi.fn();
const EXAM = { id: "00000000-0000-4000-8000-000000000010", title: "Synthetic Exam", instructions: "Rules", scheduled_start_at: "2099-10-05T04:00:00.000Z", started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00.000Z", question_count: 0, assigned_count: 1 } as const;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2099-10-05T03:00:00.000Z"));
  fetchMock.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ExamForm", () => {
  function renderForm(canDeleteFinalized = false) {
    return render(<ToastProvider><ExamForm examId={EXAM.id} canDeleteFinalized={canDeleteFinalized} /></ToastProvider>);
  }

  it("shows Section 2C readiness and converts Colombo time on save", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: EXAM, warnings: [] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, title: "Updated" } }), { status: 200 }));
    renderForm();
    expect(await screen.findByText("No questions yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.scheduled_start_at).toBe("2099-10-05T04:00:00.000Z");
    expect(body).not.toHaveProperty("questions_per_paper");
    expect(
      await within(screen.getByTestId("toast-container")).findByText("Saved."),
    ).toBeTruthy();
  });

  it("locks the threshold on a finalized exam", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, status: "finalized" }, warnings: [] }), { status: 200 }));
    renderForm();
    expect(await screen.findByLabelText("Flag threshold")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Title")).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Delete exam" })).toBeNull();
  });

  it.each(["draft", "scheduled"] as const)("offers %s deletion to a normal admin", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, status }, warnings: [] }), { status: 200 }));
    renderForm();
    expect(await screen.findByRole("button", { name: "Delete exam" })).toBeTruthy();
  });

  it.each(["draft", "scheduled", "finalized"] as const)("offers %s deletion to a super admin", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, status }, warnings: [] }), { status: 200 }));
    renderForm(true);
    expect(await screen.findByRole("button", { name: "Delete exam" })).toBeTruthy();
  });

  it("shows save request failures as persistent toasts", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam: EXAM, warnings: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Synthetic save failure." } }), { status: 500 }));
    renderForm();
    await screen.findByText("No questions yet.");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic save failure.")).toBeTruthy();
    expect(screen.queryByText("Synthetic save failure.", { selector: "section > p[role='alert']" })).toBeNull();
  });

  it("keeps initial load failures inline", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Synthetic load failure." } }), { status: 500 }));
    renderForm();

    expect(await screen.findByText("Synthetic load failure.", { selector: "section > p[role='alert']" })).toBeTruthy();
    expect(within(screen.getByTestId("toast-container")).queryByText("Synthetic load failure.")).toBeNull();
  });

  it("shows delete request failures as persistent toasts", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam: EXAM, warnings: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam: { id: EXAM.id, title: EXAM.title, status: EXAM.status }, counts: { questions: 0, assigned_candidates: 1, attempts: 0, results: 0 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Synthetic delete failure." } }), { status: 409 }));
    renderForm();
    await screen.findByText("No questions yet.");
    fireEvent.click(screen.getByRole("button", { name: "Delete exam" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete exam and results" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic delete failure.")).toBeTruthy();
    expect(screen.queryByText("Synthetic delete failure.", { selector: "section > p[role='alert']" })).toBeNull();
  });
});
