// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import type { ResultsSummaryRow } from "@/lib/grading/results-summary";
import { ResultsStats } from "./ResultsStats";

afterEach(cleanup);

it("renders all six summary cards with formatted percentages", () => {
  const rows = [
    { is_absent: false, is_final: true, total_percent: 72.25 },
    { is_absent: false, is_final: false, total_percent: 87.75 },
    { is_absent: true, is_final: false, total_percent: null },
  ] as ResultsSummaryRow[];
  render(<ResultsStats rows={rows} />);
  const stats = screen.getByLabelText("Results statistics");

  for (const [label, value] of [["Taken", "2"], ["Absent", "1"], ["Final", "1"], ["Average %", "80.0%"], ["Highest", "87.8%"], ["Lowest", "72.3%"]]) {
    const term = within(stats).getByText(label);
    expect(term.nextElementSibling?.textContent).toBe(value);
  }
});
