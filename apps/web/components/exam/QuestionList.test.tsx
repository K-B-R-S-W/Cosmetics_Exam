// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QuestionList } from "./QuestionList";

afterEach(cleanup);

const questions = [
  { id: "q1", position: 0, type: "written" as const, body_html: "<p>One</p>", image: null, marks: 1 },
  { id: "q2", position: 1, type: "mcq" as const, body_html: "<p>Two</p>", image: null, marks: 1, options: [] },
];

describe("QuestionList", () => {
  it("gives the desktop sidebar and mobile drawer their own vertical scrolling", () => {
    const css = readFileSync(resolve(process.cwd(), "styles/tablet.css"), "utf8");

    expect(css).toMatch(/\.candidate-question-sidebar\s*{[\s\S]*?min-height:\s*0[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/\.candidate-question-drawer\s*{[\s\S]*?overflow-y:\s*auto/);
  });

  it("scrolls the active question into view when it changes", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const view = render(<QuestionList questions={questions} answers={{}} activeIndex={0} onSelect={vi.fn()} drawerOpen={false} onDrawerOpen={vi.fn()} />);
    scrollIntoView.mockClear();

    view.rerender(<QuestionList questions={questions} answers={{}} activeIndex={1} onSelect={vi.fn()} drawerOpen={false} onDrawerOpen={vi.fn()} />);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

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
