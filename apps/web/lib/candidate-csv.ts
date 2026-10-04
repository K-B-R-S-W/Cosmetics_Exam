import { CANDIDATE_CLIENT_BATCH_SIZE, type CandidateImportRow } from "@/lib/candidates";
import { normalizeMer } from "@/lib/mer";

export interface IndexedCandidateImportRow {
  sourceIndex: number;
  row: CandidateImportRow;
}

export type CandidateCsvDamageReason =
  | "replacement_character"
  | "question_marks"
  | "scientific_notation_id";

export interface CandidateCsvDamage {
  row: number;
  reason: CandidateCsvDamageReason;
}

const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i;

export function maskNicForPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const visible = trimmed.slice(-3);
  return `${"•".repeat(Math.max(0, trimmed.length - visible.length))}${visible}`;
}

export function findCandidateCsvDamage(
  rows: CandidateImportRow[],
): CandidateCsvDamage[] {
  const damage: CandidateCsvDamage[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const textFields = [row.mer_code, row.full_name, row.outlet ?? ""];

    if ([...textFields, row.nic].some((value) => value.includes("\uFFFD"))) {
      damage.push({ row: rowNumber, reason: "replacement_character" });
    }

    if (
      textFields.some(
        (value) => (value.match(/\?/g)?.length ?? 0) >= 3,
      )
    ) {
      damage.push({ row: rowNumber, reason: "question_marks" });
    }

    if (SCIENTIFIC_NOTATION.test(row.nic.trim())) {
      damage.push({ row: rowNumber, reason: "scientific_notation_id" });
    }
  });

  return damage;
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
