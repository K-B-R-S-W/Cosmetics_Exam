// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExamCandidates } from "./ExamCandidates";

const fetchMock = vi.fn();
const assignedBody = { exam: { id: "exam-1", title: "Synthetic Exam", status: "draft" }, items: [{ candidate_id: "cand-1", mer_code: "TEST-001", full_name: "Synthetic Candidate", outlet: "Training", attempt_id: "attempt-1", attempt_status: "not_started" }] };
const availableBody = { items: [{ candidate_id: "cand-2", mer_code: "TEST-002", full_name: "Second Candidate", outlet: null }], total: 1, scan_limit: 1000, scanned_count: 1 };

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

  it("sends 230 selected candidates in 100, 100 and 30 ID batches and aggregates totals", async () => {
    const candidates = Array.from({ length: 230 }, (_, index) => ({
      candidate_id: `candidate-${index}`,
      mer_code: `TEST-${String(index).padStart(3, "0")}`,
      full_name: `Synthetic Candidate ${index}`,
      outlet: null,
    }));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...assignedBody, items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: candidates, total: 230, scan_limit: 1000, scanned_count: 230 }), { status: 200 }));
    render(<ExamCandidates examId="exam-1" />);
    await screen.findByLabelText("Select available TEST-000");
    const selectAll = await screen.findByLabelText("Select all shown");
    fireEvent.click(selectAll);
    const addButton = await screen.findByRole(
      "button",
      { name: "Add selected (230)" },
      { timeout: 10_000 },
    );
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 100, already_assigned: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 98, already_assigned: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 30, already_assigned: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...assignedBody, items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...availableBody, items: [], total: 0, scanned_count: 0 }), { status: 200 }));
    fireEvent.click(addButton);
    expect(await screen.findByText("228 added. 2 were already assigned.")).toBeTruthy();
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls.map(([, init]) => JSON.parse(String(init?.body)).candidate_ids.length)).toEqual([100, 100, 30]);
  });

  it("reloads and reports the completed count when a later add batch fails", async () => {
    const candidates = Array.from({ length: 230 }, (_, index) => ({
      candidate_id: `candidate-${index}`,
      mer_code: `TEST-${String(index).padStart(3, "0")}`,
      full_name: `Synthetic Candidate ${index}`,
      outlet: null,
    }));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...assignedBody, items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: candidates, total: 230, scan_limit: 1000, scanned_count: 230 }), { status: 200 }));
    render(<ExamCandidates examId="exam-1" />);
    await screen.findByLabelText("Select available TEST-000");
    fireEvent.click(await screen.findByLabelText("Select all shown"));
    const addButton = await screen.findByRole(
      "button",
      { name: "Add selected (230)" },
      { timeout: 10_000 },
    );
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 100, already_assigned: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Second batch failed." } }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...assignedBody, items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...availableBody, items: [], total: 0, scanned_count: 0 }), { status: 200 }));
    fireEvent.click(addButton);
    expect(await screen.findByText("100 added before the error.")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Second batch failed.");
    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls.map(([, init]) => JSON.parse(String(init?.body)).candidate_ids.length)).toEqual([100, 100]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  });

  it("asks the admin to search when the available-candidate scan reaches its limit", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(assignedBody), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...availableBody, scan_limit: 1000, scanned_count: 1000 }), { status: 200 }));
    render(<ExamCandidates examId="exam-1" />);
    expect(await screen.findByText("Search to narrow the list.")).toBeTruthy();
  });
});
