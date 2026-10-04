import { describe, expect, it } from "vitest";

import { candidateImportBatches, repeatedMerIndexes } from "./candidate-csv";
import type { CandidateImportRow } from "./candidates";

function syntheticRow(index: number): CandidateImportRow {
  return {
    mer_code: `TEST-${String(index).padStart(3, "0")}`,
    full_name: `Synthetic candidate ${index}`,
    outlet: "පුහුණු ශාඛාව",
    nic: "190000000000",
  };
}

describe("candidate CSV helpers", () => {
  it("flags every normalized repeated MER after the first across the whole file", () => {
    const rows = Array.from({ length: 52 }, (_, index) => syntheticRow(index));
    rows[50] = { ...rows[50], mer_code: " test-000 " };
    rows[51] = { ...rows[51], mer_code: "TEST-000" };

    expect([...repeatedMerIndexes(rows)]).toEqual([50, 51]);
  });

  it("batches at 50 while preserving Sinhala exactly", () => {
    const rows = Array.from({ length: 101 }, (_, sourceIndex) => ({
      sourceIndex,
      row: syntheticRow(sourceIndex),
    }));
    const batches = candidateImportBatches(rows);

    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 1]);
    expect(batches[0]?.[0]?.row.outlet).toBe("පුහුණු ශාඛාව");
  });
});
