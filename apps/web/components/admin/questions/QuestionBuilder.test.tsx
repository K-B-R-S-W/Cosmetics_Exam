// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/editor/TiptapEditor", () => ({
  TiptapEditor: ({ ariaLabel, disabled, value, onChange }: { ariaLabel: string; disabled?: boolean; value: string; onChange: (value: string) => void }) => <textarea aria-label={ariaLabel} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("@/components/admin/questions/QuestionImageField", () => ({
  QuestionImageField: ({ disabled }: { disabled?: boolean }) => <button type="button" disabled={disabled}>Mock image field</button>,
}));

import { QuestionBuilder } from "./QuestionBuilder";

const fetchMock = vi.fn();
const examId = "00000000-0000-4000-8000-000000000102";
const questionId = "00000000-0000-4000-8000-000000000101";
const optionA = "00000000-0000-4000-8000-000000000103";
const optionB = "00000000-0000-4000-8000-000000000104";
const question = {
  id: questionId, exam_id: examId, position: 0, type: "mcq", body_html: "<p>Synthetic question</p>", marks: 1, image: null,
  options: [{ id: optionA, position: 0, label: "A", text_html: "<p>A</p>" }, { id: optionB, position: 1, label: "B", text_html: "<p>B</p>" }],
  answer_key: { correct_option_id: optionA, model_answer: null, grading_notes: null, calibration: [] },
};

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
function initial(status: "draft" | "live" = "draft", items: unknown[] = [question]) {
  fetchMock.mockResolvedValueOnce(response({ exam: { id: examId, title: "Synthetic Exam", status } })).mockResolvedValueOnce(response({ items }));
}

beforeEach(() => {
  fetchMock.mockReset(); navigation.push.mockReset(); vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QuestionBuilder", () => {
  it("keeps client-generated question and option UUIDs when a lost save is retried", async () => {
    initial("draft", []);
    render(<QuestionBuilder examId={examId} />);
    await screen.findByText("No questions yet. Add a multiple-choice or written question to start.");
    fireEvent.click(screen.getByRole("button", { name: "Add MCQ" }));
    fetchMock.mockResolvedValueOnce(response({ error: { message: "Connection lost." } }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Connection lost.");
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const submitted = JSON.parse(String(init?.body));
      return response({ question: { ...submitted, position: 0, options: submitted.options.map((item: object, index: number) => ({ ...item, position: index, label: String.fromCharCode(65 + index) })) } }, 201);
    });
    fireEvent.click(screen.getByRole("button", { name: "Save question" }));
    await screen.findByText("Question saved.");
    const posts = fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && url === "/api/admin/questions");
    const bodies = posts.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].id).toBe(bodies[0].id);
    expect(bodies[1].options.map((item: { id: string }) => item.id)).toEqual(bodies[0].options.map((item: { id: string }) => item.id));
  });

  it("warns before leaving a dirty draft", async () => {
    initial("draft", []); render(<QuestionBuilder examId={examId} />);
    await screen.findByText(/No questions yet/); fireEvent.click(screen.getByRole("button", { name: "Add written question" }));
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByText("You have unsaved changes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("locks structural controls while live but saves a changed answer key", async () => {
    initial("live"); render(<QuestionBuilder examId={examId} />);
    expect(await screen.findByText("Questions are locked while the exam is live. You can still edit answer keys.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add MCQ" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Question text") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio", { name: "Correct answer" })[1]!);
    fetchMock.mockResolvedValueOnce(response({ answer_key: { ...question.answer_key, correct_option_id: optionB }, regrade_needed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save answer key" }));
    expect(await screen.findByText(/Scores already exist/)).toBeTruthy();
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/api/admin/answer-keys");
  });

  it("disables answer-key editing after grading_in_progress", async () => {
    initial("live"); render(<QuestionBuilder examId={examId} />);
    await screen.findByText("Synthetic question");
    fireEvent.click(screen.getAllByRole("radio", { name: "Correct answer" })[1]!);
    fetchMock.mockResolvedValueOnce(response({ error: { code: "grading_in_progress", message: "Database detail" } }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Save answer key" }));
    expect(await screen.findByText(/Answer keys are locked while grading is running/)).toBeTruthy();
    expect((screen.getAllByRole("radio", { name: "Correct answer" })[0] as HTMLInputElement).disabled).toBe(true);
  });

  it("supports keyboard move buttons and persists the complete order", async () => {
    const second = { ...question, id: "00000000-0000-4000-8000-000000000105", position: 1, body_html: "<p>Second</p>" };
    initial("draft", [question, second]); render(<QuestionBuilder examId={examId} />);
    await screen.findByText("Synthetic question");
    fetchMock.mockResolvedValueOnce(response({ updated: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Move question 2 up" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const reorderCall = fetchMock.mock.calls[2]!;
    expect(JSON.parse(String(reorderCall[1]?.body)).ordered_ids).toEqual([second.id, question.id]);
  });
});
