// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamForm } from "./ExamForm";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const fetchMock = vi.fn();
const EXAM = { id: "00000000-0000-4000-8000-000000000010", title: "Synthetic Exam", instructions: "Rules", scheduled_start_at: "2099-10-05T04:00:00.000Z", started_at: null, ends_at: null, force_ended_at: null, duration_min: 45, status: "draft", navigation_mode: "free", shuffle: false, flag_threshold: 10, is_practice: false, created_at: "2026-10-04T00:00:00.000Z", question_count: 0, assigned_count: 1 } as const;

beforeEach(() => { fetchMock.mockReset(); router.push.mockReset(); router.refresh.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ExamForm", () => {
  it("shows Section 2C readiness and converts Colombo time on save", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: EXAM, warnings: [] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, title: "Updated" } }), { status: 200 }));
    render(<ExamForm examId={EXAM.id} />);
    expect(await screen.findByText("No questions yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(body.scheduled_start_at).toBe("2099-10-05T04:00:00.000Z");
    expect(body).not.toHaveProperty("questions_per_paper");
  });

  it("locks the threshold on a finalized exam", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ exam: { ...EXAM, status: "finalized" }, warnings: [] }), { status: 200 }));
    render(<ExamForm examId={EXAM.id} />);
    expect(await screen.findByLabelText("Flag threshold")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Title")).toHaveProperty("disabled", false);
  });
});
