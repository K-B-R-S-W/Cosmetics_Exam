import { describe, expect, it } from "vitest";
import { containsSinhala, langFor } from "./lang";

describe("language helpers", () => {
  it("detects Sinhala code points", () => {
    expect(containsSinhala("විභාගය Exam")).toBe(true);
    expect(langFor("English only")).toBe("en");
    expect(langFor("සිංහල")).toBe("si");
  });
});
