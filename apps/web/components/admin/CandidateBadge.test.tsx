// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CandidateBadge } from "./CandidateBadge";
describe("CandidateBadge", () => {
  it("has complete amber and red accessible names", () => {
    const view = render(<CandidateBadge merCode="MER-1" count={5} threshold={10} />);
    expect(screen.getByLabelText("MER-1, 5 violations, warning")).toBeTruthy();
    view.rerender(<CandidateBadge merCode="MER-1" count={10} threshold={10} />);
    expect(screen.getByLabelText("MER-1, 10 violations, flagged")).toBeTruthy();
  });
});
