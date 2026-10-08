// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ResultsSummary } from "./ResultsSummary";

const rows = [
  { attempt_id: "a1", mer_code: "MER-2", full_name: "Needs Review", outlet: "B", attempt_status: "finalized", submit_reason: "manual", violations_counted: 10, violations_logged: 12, question_numbers: [3, 7], mcq_marks: 2, written_marks: 3, total_marks: 5, total_percent: 50, needs_review_count: 1, unscored_count: 0, is_final: false, is_absent: false },
  { attempt_id: "a2", mer_code: "MER-1", full_name: "Absent Person", outlet: "A", attempt_status: "finalized", submit_reason: "forced", violations_counted: 0, violations_logged: 0, question_numbers: [], mcq_marks: null, written_marks: null, total_marks: null, total_percent: null, needs_review_count: 0, unscored_count: 0, is_final: false, is_absent: true },
  { attempt_id: "a3", mer_code: "MER-3", full_name: "Not Graded", outlet: "C", attempt_status: "submitted", submit_reason: "auto", violations_counted: 1, violations_logged: 2, question_numbers: [1], mcq_marks: null, written_marks: null, total_marks: null, total_percent: null, needs_review_count: 0, unscored_count: 1, is_final: false, is_absent: false },
];

afterEach(cleanup);

it("excludes absent candidates from the final-result denominator and gives Absent status priority", () => {
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={rows} />);
  expect(screen.getByText("0 of 2 results are final.")).toBeTruthy();
  expect(screen.getAllByText("Absent").length).toBeGreaterThan(1);
  expect(screen.getByText("Did not take the exam").closest("a")).toBeNull();
  expect(screen.getByText("2 results are not final yet.")).toBeTruthy();
});

it("filters every category and sorts by a column header", () => {
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={rows} />);
  const filters = screen.getByLabelText("Result filters");
  for (const [name, expected] of [["Needs review", "Needs Review"], ["Not graded", "Not Graded"], ["Flagged", "Needs Review"], ["Absent", "Absent Person"]] as const) {
    fireEvent.click(within(filters).getByRole("button", { name }));
    expect(screen.getByText(expected)).toBeTruthy();
  }
  fireEvent.click(within(filters).getByRole("button", { name: "All" }));
  fireEvent.click(screen.getByRole("button", { name: "MER code" }));
  expect(screen.getAllByTestId("summary-row")[0]?.textContent).toContain("MER-3");
});

it("hides the not-final notice when every taken result is final", () => {
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={[{ ...rows[0], is_final: true, needs_review_count: 0 }]} />);
  expect(screen.queryByText(/results are not final yet/)).toBeNull();
});
