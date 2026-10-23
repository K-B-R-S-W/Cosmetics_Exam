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
  expect(screen.queryByRole("button", { name: "Paper" })).toBeNull();
  expect(screen.getByRole("link", { name: "Export CSV" })).toBeTruthy();
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

it("shows formatted score bars, status chips, threshold badges and a sticky header", () => {
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={rows} />);
  expect(screen.getByRole("progressbar", { name: "MER-2 score" }).getAttribute("value")).toBe("50");
  expect(screen.getByLabelText("MER-2, 10 violations, flagged")).toBeTruthy();
  expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
  expect(screen.getByText("Submitted").className).toContain("rounded-full");
  expect(document.querySelector("thead")?.className).toContain("sticky");
});

it("renders more than twenty result rows without changing the summary table", () => {
  const manyRows = Array.from({ length: 21 }, (_, index) => ({ ...rows[0], attempt_id: `attempt-${index}`, mer_code: `MER-${index + 1}` }));
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={manyRows} />);
  expect(screen.getAllByTestId("summary-row")).toHaveLength(21);
});

it("shows ranks, leaves absent and non-final rows unranked, and sorts by rank", () => {
  const rankedRows = [
    { ...rows[0], attempt_id: "high", mer_code: "MER-H", total_percent: 90, is_final: true, needs_review_count: 0 },
    { ...rows[0], attempt_id: "tie-a", mer_code: "MER-T1", total_percent: 75, is_final: true, needs_review_count: 0 },
    { ...rows[0], attempt_id: "tie-b", mer_code: "MER-T2", total_percent: 75, is_final: true, needs_review_count: 0 },
    rows[1],
    rows[2],
  ];
  render(<ResultsSummary exam={{ id: "exam-1", title: "Exam", flag_threshold: 10 }} rows={rankedRows} />);

  expect(screen.getByRole("button", { name: "Rank" })).toBeTruthy();
  const rendered = screen.getAllByTestId("summary-row");
  expect(rendered.find((item) => item.textContent?.includes("MER-H"))?.firstElementChild?.textContent).toBe("1");
  expect(rendered.find((item) => item.textContent?.includes("MER-T1"))?.firstElementChild?.textContent).toBe("2");
  expect(rendered.find((item) => item.textContent?.includes("MER-T2"))?.firstElementChild?.textContent).toBe("2");
  expect(rendered.find((item) => item.textContent?.includes("Absent Person"))?.firstElementChild?.textContent).toBe("—");
  expect(rendered.find((item) => item.textContent?.includes("Not Graded"))?.firstElementChild?.textContent).toBe("—");

  fireEvent.click(screen.getByRole("button", { name: "Rank" }));
  expect(screen.getAllByTestId("summary-row")[0]?.textContent).toContain("MER-H");
});
