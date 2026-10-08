// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ResultsTabs } from "./ResultsTabs";

afterEach(cleanup);

it("uses the canonical exam query parameter in both tab links", () => {
  render(<ResultsTabs examId="exam-1" active="summary" />);
  expect(screen.getByRole("link", { name: "Grading" }).getAttribute("href")).toBe("/admin/results?exam=exam-1");
  expect(screen.getByRole("link", { name: "Summary" }).getAttribute("href")).toBe("/admin/results/summary?exam=exam-1");
});
