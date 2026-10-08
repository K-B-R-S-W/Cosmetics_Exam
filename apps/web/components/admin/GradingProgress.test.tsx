// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GradingProgress } from "./GradingProgress";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows only key labels and queue counts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [], queue: { pending: 2 }, keys: ["key1", "key2", "key3"].map((label) => ({ label, status: "active", cooldown_until: null, used: 0, limit: 100 })), logs: [], not_graded: 0 }))));
  render(<GradingProgress examId="exam" examStatus="finalized" attempts={[]} />);
  expect(await screen.findByText("key1: active — 0 / 100")).toBeTruthy();
  expect(screen.getByText("key2: active — 0 / 100")).toBeTruthy();
  expect(screen.getByText("key3: active — 0 / 100")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
});

it("offers Start grading only for a finalized exam with no active run", async () => {
  const response = { runs: [], queue: {}, keys: [], logs: [], not_graded: 0 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
  const view = render(<GradingProgress examId="exam" examStatus="finalized" attempts={[]} />);
  expect(await screen.findByRole("button", { name: "Start grading" })).toBeTruthy();
  view.rerender(<GradingProgress examId="exam" examStatus="live" attempts={[]} />);
  expect(screen.queryByRole("button", { name: "Start grading" })).toBeNull();
  expect(screen.getByText("End the exam first")).toBeTruthy();
});

it("does not offer Start grading while a run is active", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [{ id: "run", status: "running" }], queue: { running: 1 }, keys: [], logs: [], not_graded: 0 }))));
  render(<GradingProgress examId="exam" examStatus="finalized" attempts={[]} />);
  await waitFor(() => expect(screen.getByText("1")).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Start grading" })).toBeNull();
});

it("uses the existing full-grade body and reports the authoritative estimate after start", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [], queue: {}, keys: [], logs: [], not_graded: 0 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ estimated_calls: 7 }), { status: 202 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ runs: [{ id: "run", status: "running" }], queue: { pending: 1 }, keys: [], logs: [], not_graded: 1 })));
  vi.stubGlobal("fetch", fetchMock);
  render(<GradingProgress examId="exam" examStatus="finalized" attempts={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start grading" }));
  expect(screen.getByRole("heading", { name: "Start grading?" })).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Start grading" })[1]!);
  expect(await screen.findByText(/Estimated Gemini calls: 7/u)).toBeTruthy();
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/exams/exam/grade", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chunk_size: 10, mcq_only: false }),
  });
});
