// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamList } from "./ExamList";

const fetchMock = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const success = vi.fn();
const error = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success, error }) }));
beforeEach(() => {
  fetchMock.mockReset(); push.mockReset(); refresh.mockReset(); success.mockReset(); error.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ExamList", () => {
  it("renders counts, Colombo time and the status action", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "exam-1", title: "Synthetic Exam", instructions: null, scheduled_start_at: "2026-10-05T04:00:00.000Z", started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "scheduled", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: true, created_at: "2026-10-04T00:00:00.000Z", question_count: 12, assigned_count: 23 }] }), { status: 200 }));
    render(<ExamList />);
    expect(await screen.findByText("Synthetic Exam")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("23")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe("/admin/exams/exam-1");
    expect(screen.getByText("Practice")).toBeTruthy();
  });

  it("duplicates an exam of any status and opens the copy", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "exam-live", title: "Live Exam", instructions: null, scheduled_start_at: null, started_at: "2026-10-05T04:00:00.000Z", ends_at: "2026-10-05T05:00:00.000Z", force_ended_at: null, duration_min: 45, status: "live", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00.000Z", question_count: 2, assigned_count: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam_id: "exam-copy", image_failures: [] }), { status: 201 }));
    render(<ExamList />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate" }));
    expect(await screen.findByText("Duplicating…")).toBeTruthy();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/admin/exams/exam-copy"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/exams/exam-live/duplicate", { method: "POST" });
    expect(success).toHaveBeenCalledWith("Exam duplicated.");
  });

  it("reports image-copy failures without discarding the duplicate", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "exam-1", title: "Exam", instructions: null, scheduled_start_at: null, started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00.000Z", question_count: 1, assigned_count: 0 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam_id: "exam-copy", image_failures: [{ question_id: "q", reason: "copy_failed" }] }), { status: 201 }));
    render(<ExamList />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate" }));
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Exam duplicated. 1 images could not be copied."));
    expect(push).toHaveBeenCalledWith("/admin/exams/exam-copy");
  });

  it("shows impact counts, supports cancel, and confirms finalized deletion", async () => {
    const finalized = { id: "exam-final", title: "Final Exam", instructions: null, scheduled_start_at: null, started_at: "2026-10-05T04:00:00.000Z", ends_at: "2026-10-05T05:00:00.000Z", force_ended_at: null, duration_min: 45, status: "finalized", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00.000Z", question_count: 2, assigned_count: 3 };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [finalized] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam: { id: finalized.id, title: finalized.title, status: finalized.status }, counts: { questions: 2, assigned_candidates: 3, attempts: 4, results: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exam: { id: finalized.id, title: finalized.title, status: finalized.status }, counts: { questions: 2, assigned_candidates: 3, attempts: 4, results: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, storage_failed: 0, warnings: [] }), { status: 200 }));
    render(<ExamList />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete exam" }));
    const firstDialog = await screen.findByRole("dialog");
    expect(firstDialog.classList.contains("text-left")).toBe(true);
    expect(within(firstDialog).getByText("Are you sure you want to delete this exam and its results too? This cannot be undone.")).toBeTruthy();
    expect(within(firstDialog).getByText("4")).toBeTruthy();
    expect(within(firstDialog).getByText("1")).toBeTruthy();
    expect(within(firstDialog).getByRole("link", { name: "Export results CSV first" }).getAttribute("href")).toContain("exam_id=exam-final");
    fireEvent.click(within(firstDialog).getByRole("button", { name: "Cancel" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete exam" }));
    const secondDialog = await screen.findByRole("dialog");
    fireEvent.click(within(secondDialog).getByRole("button", { name: "Delete exam and results" }));
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Exam deleted."));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/exams/exam-final", { method: "DELETE" });
    expect(screen.queryByText("Final Exam")).toBeNull();
  });
});
