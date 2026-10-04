import { describe, expect, it } from "vitest";

import {
  CANDIDATE_NAME_MAX_LENGTH,
  CANDIDATE_OUTLET_MAX_LENGTH,
  createCandidateSchema,
  importCandidatesSchema,
  updateCandidateSchema,
} from "./candidates";

describe("candidate validation", () => {
  it("normalizes MER while preserving Sinhala names and outlets", () => {
    const parsed = createCandidateSchema.parse({
      mer_code: " test-001 ",
      full_name: "නිර්මාණ පරීක්ෂක",
      outlet: "පුහුණු ශාඛාව",
      nic: "190000000000",
    });

    expect(parsed).toMatchObject({
      mer_code: "TEST-001",
      full_name: "නිර්මාණ පරීක්ෂක",
      outlet: "පුහුණු ශාඛාව",
    });
  });

  it("enforces the generous text caps", () => {
    const base = {
      mer_code: "TEST-001",
      full_name: "A".repeat(CANDIDATE_NAME_MAX_LENGTH),
      outlet: "B".repeat(CANDIDATE_OUTLET_MAX_LENGTH),
      nic: "190000000000",
    };

    expect(createCandidateSchema.safeParse(base).success).toBe(true);
    expect(
      createCandidateSchema.safeParse({ ...base, mer_code: "M".repeat(65) })
        .success,
    ).toBe(false);
    expect(
      createCandidateSchema.safeParse({
        ...base,
        full_name: "A".repeat(CANDIDATE_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      createCandidateSchema.safeParse({
        ...base,
        outlet: "B".repeat(CANDIDATE_OUTLET_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("allows a blank edit NIC so the old hash can be kept", () => {
    expect(updateCandidateSchema.parse({ nic: "" })).toEqual({ nic: "" });
  });

  it("caps server import batches at 100 rows", () => {
    expect(
      importCandidatesSchema.safeParse({
        rows: Array.from({ length: 101 }, () => ({})),
      }).success,
    ).toBe(false);
  });
});
