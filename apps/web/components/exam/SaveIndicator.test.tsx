// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BATCH_THREE_NOTE, SaveIndicator } from "./SaveIndicator";

describe("SaveIndicator", () => {
  it("states truthfully that this batch does not save answers", () => {
    render(<SaveIndicator />);
    expect(screen.getByRole("status").textContent).toBe(BATCH_THREE_NOTE);
    expect(screen.queryByText(/^Saved/)).toBeNull();
  });
});
