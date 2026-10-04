// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamCandidates } from "./ExamCandidates";

const fetchMock = vi.fn();
const assignedBody = { exam: { id: "exam-1", title: "Synthetic Exam", status: "draft" }, items: [{ candidate_id: "cand-1", mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training", attempt_id: "attempt-1", attempt_status: "not_started" }] };
const availableBody = { items: [{ candidate_id: "cand-2", mer_code: "TEST-002", full_name: "Second Candidate", outlet: null }], total: 1 };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ExamCandidates", () => {
  it("shows the already-joined blocked message after an unassign response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(assignedBody), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify(availableBody), { status: 200 }));
    render(<ExamCandidates examId="exam-1" />);
    const checkbox = await screen.findByLabelText("Select assigned TEST-001");
    fireEvent.click(checkbox);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ removed: [], blocked: [{ candidate_id: "cand-1", reason: "attempt_started" }] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify(assignedBody), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify(availableBody), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    expect(await screen.findByText(/could not be removed because they have already joined the exam/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
  });
});
