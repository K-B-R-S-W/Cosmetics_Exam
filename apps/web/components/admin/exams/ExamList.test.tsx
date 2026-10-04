// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamList } from "./ExamList";

const fetchMock = vi.fn();
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
});
