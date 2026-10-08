import { describe, expect, it } from "vitest";
import { gradingHtmlToText } from "./html-to-text";

describe("gradingHtmlToText", () => {
  it("strips markup and decodes entities without changing Sinhala", () => {
    expect(gradingHtmlToText("<p>  පිළිතුර&nbsp;<strong>හරි</strong></p>"))
      .toBe("පිළිතුර හරි");
  });
  it("caps output", () => expect(gradingHtmlToText("a".repeat(2_001))).toHaveLength(2_000));
});
