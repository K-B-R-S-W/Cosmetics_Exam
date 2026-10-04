import { describe, expect, it } from "vitest";

import { questionFieldErrors } from "./question-types";

describe("questionFieldErrors", () => {
  it("maps API paths to friendly question, option and calibration messages", () => {
    expect(questionFieldErrors([
      { path: "body_html", message: "Enter question text or attach an image." },
      { path: "options.1.text_html", message: "Enter option text." },
      { path: "answer_key.calibration.0.marks", message: "Too high." },
    ])).toEqual({
      body_html: "Question text is empty.",
      "options.1.text_html": "Option B needs text.",
      "answer_key.calibration.0.marks": "Calibration marks cannot exceed the question marks.",
    });
  });
});
