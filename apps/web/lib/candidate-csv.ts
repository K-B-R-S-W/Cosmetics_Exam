import { CANDIDATE_CLIENT_BATCH_SIZE, type CandidateImportRow } from "@/lib/candidates";
import { normalizeMer } from "@/lib/mer";

export interface IndexedCandidateImportRow {
  sourceIndex: number;
  row: CandidateImportRow;
}

export function repeatedMerIndexes(rows: CandidateImportRow[]): Set<number> {
  const seen = new Set<string>();
  const repeated = new Set<number>();

  rows.forEach((row, index) => {
    const mer = normalizeMer(row.mer_code);
    if (!mer) return;

    if (seen.has(mer)) {
      repeated.add(index);
    } else {
      seen.add(mer);
    }
  });

  return repeated;
}

export function candidateImportBatches(
  rows: IndexedCandidateImportRow[],
): IndexedCandidateImportRow[][] {
  const batches: IndexedCandidateImportRow[][] = [];
  for (let index = 0; index < rows.length; index += CANDIDATE_CLIENT_BATCH_SIZE) {
    batches.push(rows.slice(index, index + CANDIDATE_CLIENT_BATCH_SIZE));
  }
  return batches;
}
