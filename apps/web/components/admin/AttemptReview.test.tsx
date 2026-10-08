// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { vi } from "vitest";
import { AttemptReview } from "./AttemptReview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

it("shows an ungraded banner and override indicator", () => {
  render(<AttemptReview attemptId="a" items={[{ question_id: "q1", type: "written", question: "One", answer: "A", model_answer: "M", selected_option: null, correct_option: null, max_marks: 2, score: null }, { question_id: "q2", type: "written", question: "Two", answer: "B", model_answer: "M", selected_option: null, correct_option: null, max_marks: 2, score: { source: "override", marks: 1, reason: null, needs_review: false, details: null } }]} />);
  expect(screen.getByText("1 questions not graded.")).toBeTruthy(); expect(screen.getByText(/Override/)).toBeTruthy();
});

it("shows selected and correct MCQ options without written-answer labels", () => {
  render(<AttemptReview attemptId="a" items={[{ question_id: "q1", type: "mcq", question: "One", answer: "", model_answer: "", selected_option: { label: "a", text: "Candidate choice" }, correct_option: { label: "b", text: "Correct choice" }, max_marks: 1, score: { source: "mcq", marks: 0, reason: null, needs_review: false, details: null } }]} />);
  expect(screen.getByText("a. Candidate choice")).toBeTruthy();
  expect(screen.getByText("b. Correct choice")).toBeTruthy();
  expect(screen.getByText("Selected:")).toBeTruthy();
  expect(screen.getByText("Correct:")).toBeTruthy();
  expect(screen.queryByText("Candidate answer:")).toBeNull();
  expect(screen.queryByText("Model answer:")).toBeNull();
});

it("shows No answer for an unanswered MCQ", () => {
  render(<AttemptReview attemptId="a" items={[{ question_id: "q1", type: "mcq", question: "One", answer: "", model_answer: "", selected_option: null, correct_option: { label: "b", text: "Correct choice" }, max_marks: 1, score: null }]} />);
  expect(screen.getByText("No answer")).toBeTruthy();
});

it("keeps written answer and model-answer rendering unchanged", () => {
  render(<AttemptReview attemptId="a" items={[{ question_id: "q1", type: "written", question: "One", answer: "Written answer", model_answer: "Written model", selected_option: null, correct_option: null, max_marks: 2, score: null }]} />);
  expect(screen.getByText("Written answer")).toBeTruthy();
  expect(screen.getByText("Written model")).toBeTruthy();
  expect(screen.getByText("Candidate answer:")).toBeTruthy();
  expect(screen.getByText("Model answer:")).toBeTruthy();
});
