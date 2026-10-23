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

function mixedCsv() {
  const row = (values: string[]) => values.map((value) => /[",]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(",");
  const valid = Array.from({ length: 12 }, (_, index) => row([
    "written", index === 0 ? "සිංහල ප්‍රශ්නය" : `Valid question ${index + 1}`,
    "", "", "", "", "", "", "", "", "", "", "", "1", index === 0 ? "සිංහල පිළිතුර" : `Model ${index + 1}`, "",
  ]));
  const multiple = ["A,B", "A,B,D", "A & B", "A/B", "A and B", "AB", ' "A,B,C" '].map((correct, index) => row([
    "mcq", `Multiple ${index + 1}`, "One", "Two", "Three", "Four", "", "", "", "", "", "", correct, "1", "", "",
  ]));
  const malformed = row(["mcq", "Malformed", "One", "Two", "", "", "", "", "", "", "", "", "A", "1", "", "", "extra", "extra"]);
  return `\uFEFF${QUESTION_IMPORT_COLUMNS.join(",")}\r\n${[...valid, ...multiple, malformed].join("\r\n")}\r\n`;
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

  it("keeps previewing valid rows when one spreadsheet row has too many columns", async () => {
    const multipleIssues = Array.from({ length: 7 }, (_, index) => ({
      row: index + 14,
      code: "multiple_correct_answers",
      message: "Only one correct answer is supported; this row lists several.",
    }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      dry_run: true,
      ready: Array.from({ length: 12 }, (_, index) => index + 2),
      issues: multipleIssues,
    }), { status: 200 }));
    render(<ToastProvider><QuestionImport examId={examId} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Choose CSV"), { target: { files: [new File([mixedCsv()], "questions.csv", { type: "text/csv" })] } });

    expect(await screen.findByText("20 rows loaded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("12 ready, 8 need attention. Nothing has been saved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import 12 questions" })).toBeTruthy();
    expect(screen.getByText("Row 21 has 18 columns instead of 16. Check for a comma inside a cell that is not wrapped in quotes, or a space before an opening quote.")).toBeTruthy();
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(sent.dry_run).toBe(true);
    expect(sent.rows).toHaveLength(19);
    expect(sent.rows.some((item: { source_row: number }) => item.source_row === 21)).toBe(false);
    expect(sent.rows[0].question).toBe("සිංහල ප්‍රශ්නය");
    expect(sent.rows[0].model_answer).toBe("සිංහල පිළිතුර");
  });

  it("keeps a missing required header as a fatal file error", async () => {
    const missingHeader = csv().replace("model_answer,", "");
    render(<ToastProvider><QuestionImport examId={examId} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Choose CSV"), { target: { files: [new File([missingHeader], "questions.csv", { type: "text/csv" })] } });

    expect((await screen.findByRole("alert")).textContent).toBe("Missing CSV columns: model_answer.");
    expect(screen.queryByRole("button", { name: "Check file" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a too-short row without sending that invalid row", async () => {
    const tooShort = csv().replace(/,\r\n$/, "\r\n");
    render(<ToastProvider><QuestionImport examId={examId} /></ToastProvider>);
    fireEvent.change(screen.getByLabelText("Choose CSV"), { target: { files: [new File([tooShort], "questions.csv", { type: "text/csv" })] } });

    expect(await screen.findByText("1 rows loaded.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("0 ready, 1 need attention. Nothing has been saved.")).toBeTruthy();
    expect(screen.getByText("Row 2 has 15 columns instead of 16. Check for a comma inside a cell that is not wrapped in quotes, or a space before an opening quote.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
