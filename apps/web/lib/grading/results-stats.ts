import type { ResultsSummaryRow } from "./results-summary";

export type ResultsStats = {
  taken: number;
  absent: number;
  final: number;
  averagePercent: number | null;
  highestPercent: number | null;
  lowestPercent: number | null;
};

export function calculateResultsStats(rows: readonly ResultsSummaryRow[]): ResultsStats {
  const taken = rows.filter((row) => !row.is_absent);
  const percentages = taken.flatMap((row) => row.total_percent === null ? [] : [row.total_percent]);

  return {
    taken: taken.length,
    absent: rows.length - taken.length,
    final: taken.filter((row) => row.is_final).length,
    averagePercent: percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : null,
    highestPercent: percentages.length ? Math.max(...percentages) : null,
    lowestPercent: percentages.length ? Math.min(...percentages) : null,
  };
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}
