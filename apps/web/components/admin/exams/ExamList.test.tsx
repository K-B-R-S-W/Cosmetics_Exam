// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamList } from "./ExamList";

const fetchMock = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const success = vi.fn();
const error = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success, error }) }));
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
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
});
