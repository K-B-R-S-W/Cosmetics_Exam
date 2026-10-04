// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionList } from "./QuestionList";

afterEach(cleanup);

const questions = [
  { id: "q1", position: 0, type: "written" as const, body_html: "<p>One</p>", image: null, marks: 1 },
  { id: "q2", position: 1, type: "mcq" as const, body_html: "<p>Two</p>", image: null, marks: 1, options: [] },
];

describe("QuestionList", () => {
  it("uses word statuses and marks the current question", () => {
    render(<QuestionList questions={questions} answers={{ q1: { answer_text: "Answer", selected_option_id: null, flagged: true }, q2: { answer_text: null, selected_option_id: null, flagged: false } }} activeIndex={0} onSelect={vi.fn()} drawerOpen={false} onDrawerOpen={vi.fn()} />);
    expect(screen.getByText("Answered, flagged")).toBeTruthy();
    expect(screen.getByText("Not answered")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Question 1/ })[0]?.getAttribute("aria-current")).toBe("step");
  });

  it("closes the drawer on selection and Escape", () => {
    const select = vi.fn();
    const open = vi.fn();
    const view = render(<QuestionList questions={questions} answers={{}} activeIndex={0} onSelect={select} drawerOpen onDrawerOpen={open} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Question 2/ }).at(-1)!);
    expect(select).toHaveBeenCalledWith(1);
    expect(open).toHaveBeenCalledWith(false);
    open.mockClear();
    view.rerender(<QuestionList questions={questions} answers={{}} activeIndex={0} onSelect={select} drawerOpen onDrawerOpen={open} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(open).toHaveBeenCalledWith(false);
  });
});
