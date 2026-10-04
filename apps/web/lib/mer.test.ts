import { describe, expect, it } from "vitest";

import { normalizeMer } from "./mer";

describe("normalizeMer", () => {
  it("trims and uppercases the shared login key representation", () => {
    expect(normalizeMer("  mer-si-0042 \t")).toBe("MER-SI-0042");
  });

  it("does not transliterate non-Latin content", () => {
    expect(normalizeMer("  mer-සිංහල-1  ")).toBe("MER-සිංහල-1");
  });
});
