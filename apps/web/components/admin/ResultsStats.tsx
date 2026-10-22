import type { ResultsSummaryRow } from "@/lib/grading/results-summary";
import { calculateResultsStats, formatPercent } from "@/lib/grading/results-stats";

export function ResultsStats({ rows }: { rows: readonly ResultsSummaryRow[] }) {
  const stats = calculateResultsStats(rows);
  const cards = [
    ["Taken", String(stats.taken)],
    ["Absent", String(stats.absent)],
    ["Final", String(stats.final)],
    ["Average %", formatPercent(stats.averagePercent)],
    ["Highest", formatPercent(stats.highestPercent)],
    ["Lowest", formatPercent(stats.lowestPercent)],
  ] as const;

  return <dl aria-label="Results statistics" className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
    {cards.map(([label, value]) => <div className="border border-line bg-surface p-4" key={label}><dt className="text-sm font-bold text-muted">{label}</dt><dd className="mt-1 text-question font-bold tabular-nums">{value}</dd></div>)}
  </dl>;
}
