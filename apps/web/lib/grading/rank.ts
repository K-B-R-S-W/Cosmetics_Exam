import type { ResultsSummaryRow } from "./results-summary";

export function rankRows(rows: readonly ResultsSummaryRow[]): Map<string, number | null> {
  const ranked = rows
    .filter((row) => row.is_final && !row.is_absent && row.total_percent !== null)
    .sort((left, right) => right.total_percent! - left.total_percent!);
  const result = new Map<string, number | null>(
    rows.map((row) => [row.attempt_id, null]),
  );
  let previousPercent: number | undefined;
  let currentRank = 0;

  ranked.forEach((row, index) => {
    if (previousPercent === undefined || row.total_percent !== previousPercent) {
      currentRank = index + 1;
      previousPercent = row.total_percent!;
    }
    result.set(row.attempt_id, currentRank);
  });

  return result;
}
