// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { QUESTION_IMPORT_COLUMNS } from "@/lib/question-import";
import { QuestionImport } from "./QuestionImport";

const fetchMock = vi.fn();
const examId = "00000000-0000-4000-8000-000000000100";
function csv(question = "සිංහල ප්‍රශ්නය") {
  const values = ["written", question, "", "", "", "", "", "", "", "", "", "", "", "1", "සිංහල පිළිතුර", ""];
  return `\uFEFF${QUESTION_IMPORT_COLUMNS.join(",")}\r\n${values.join(",")}\r\n`;
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QuestionImport", () => {
  it("parses BOM Sinhala CSV, previews without saving, then confirms", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ dry_run: true, ready: [2], issues: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dry_run: false, imported: 1, issues: [] }), { status: 200 }));
    render(<ToastProvider><QuestionImport examId={examId} /></ToastProvider>);
    const input = screen.getByLabelText("Choose CSV");
    fireEvent.change(input, { target: { files: [new File([csv()], "questions.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("1 rows loaded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("1 ready, 0 need attention. Nothing has been saved.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).dry_run).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 questions" }));
    expect(await screen.findByText("Done. 1 imported.")).toBeTruthy();
  });

  it("requires an explicit import-anyway choice for duplicate rows", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ dry_run: true, ready: [], issues: [{ row: 2, code: "duplicate_question", message: "Duplicate of a question in Existing.", can_force: true, matching_exam: "Existing" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dry_run: false, imported: 1, issues: [] }), { status: 200 }));
    render(<ToastProvider><QuestionImport examId={examId} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Choose CSV"), { target: { files: [new File([csv("Duplicate")], "questions.csv", { type: "text/csv" })] } });
    await screen.findByText("1 rows loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    const checkbox = await screen.findByRole("checkbox", { name: "Import anyway" });
    expect(screen.getByRole("button", { name: "Import 0 questions" })).toHaveProperty("disabled", true);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Import 1 questions" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const confirmed = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(confirmed.force_rows).toEqual([2]);
    expect(await within(screen.getByTestId("toast-container")).findByText("Question import completed.")).toBeTruthy();
  });
});
