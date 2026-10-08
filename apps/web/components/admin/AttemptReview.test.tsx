// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { vi } from "vitest";
import { AttemptReview } from "./AttemptReview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("shows an ungraded banner and override indicator", () => {
  render(<AttemptReview attemptId="a" items={[{ question_id: "q1", question: "One", answer: "A", model_answer: "M", max_marks: 2, score: null }, { question_id: "q2", question: "Two", answer: "B", model_answer: "M", max_marks: 2, score: { source: "override", marks: 1, reason: null, needs_review: false, details: null } }]} />);
  expect(screen.getByText("1 questions not graded.")).toBeTruthy(); expect(screen.getByText(/Override/)).toBeTruthy();
});
