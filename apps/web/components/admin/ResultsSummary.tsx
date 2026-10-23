"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CandidateBadge } from "@/components/admin/CandidateBadge";
import { ResultsStats } from "@/components/admin/ResultsStats";
import type { ResultsSummaryData, ResultsSummaryRow } from "@/lib/grading/results-summary";
import { formatPercent } from "@/lib/grading/results-stats";
import { rankRows } from "@/lib/grading/rank";

type Filter = "all" | "review" | "unscored" | "flagged" | "absent";
type SortKey = keyof ResultsSummaryRow | "rank" | "status";

function status(row: ResultsSummaryRow): string {
  if (row.is_absent) return "Absent";
  if (row.submit_reason === "forced") return "Forced";
  if (row.submit_reason === "auto") return "Auto";
  return "Submitted";
}

function value(row: ResultsSummaryRow, key: SortKey, ranks: Map<string, number | null>): string | number {
  if (key === "status") return status(row);
  if (key === "rank") return ranks.get(row.attempt_id) ?? Number.MAX_SAFE_INTEGER;
  const current = row[key];
  if (Array.isArray(current)) return current.join(",");
  if (typeof current === "boolean") return current ? 1 : 0;
  return current ?? "";
}

export function ResultsSummary({ exam, rows }: ResultsSummaryData) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "mer_code", direction: 1 });
  const ranks = useMemo(() => rankRows(rows), [rows]);
  const taken = rows.filter((row) => !row.is_absent);
  const finalCount = taken.filter((row) => row.is_final).length;
  const notFinal = taken.length - finalCount;
  const visible = useMemo(() => rows.filter((row) => {
    if (filter === "review") return row.needs_review_count > 0;
    if (filter === "unscored") return row.unscored_count > 0;
    if (filter === "flagged") return row.violations_counted >= exam.flag_threshold;
    if (filter === "absent") return row.is_absent;
    return true;
  }).sort((left, right) => String(value(left, sort.key, ranks)).localeCompare(String(value(right, sort.key, ranks)), undefined, { numeric: true }) * sort.direction), [exam.flag_threshold, filter, ranks, rows, sort]);
  const filters: Array<{ id: Filter; label: string }> = [{ id: "all", label: "All" }, { id: "review", label: "Needs review" }, { id: "unscored", label: "Not graded" }, { id: "flagged", label: "Flagged" }, { id: "absent", label: "Absent" }];
  const columns: Array<{ key: SortKey; label: string }> = [
    { key: "rank", label: "Rank" }, { key: "mer_code", label: "MER code" }, { key: "full_name", label: "Name" }, { key: "outlet", label: "Outlet" }, { key: "status", label: "Status" },
    { key: "violations_counted", label: "Violations" }, { key: "mcq_marks", label: "MCQ" }, { key: "written_marks", label: "Written" },
    { key: "total_marks", label: "Total" }, { key: "total_percent", label: "%" }, { key: "needs_review_count", label: "Review" }, { key: "unscored_count", label: "Not graded" }, { key: "is_final", label: "Final" },
  ];
  function changeSort(key: SortKey) { setSort((current) => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: 1 }); }
  return <section className="space-y-5">
    <ResultsStats rows={rows} />
    <p className="font-bold">{finalCount} of {taken.length} results are final.</p>
    <div className="flex flex-wrap gap-2" aria-label="Result filters">{filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className="min-h-11 rounded-control border border-line bg-surface px-4 font-bold aria-pressed:border-ink aria-pressed:bg-selected">{item.label}</button>)}</div>
    {visible.length === 0 ? <p>No results match this filter.</p> : <div className="max-h-[70vh] overflow-auto"><table className="w-full border-collapse bg-surface text-left"><thead className="sticky top-0 z-10 bg-surface"><tr>{columns.map((column) => <th className="border-b border-line p-3" key={column.key} aria-sort={sort.key === column.key ? (sort.direction === 1 ? "ascending" : "descending") : "none"}><button className="min-h-11 font-bold underline" type="button" onClick={() => changeSort(column.key)}>{column.label}</button></th>)}</tr></thead><tbody>{visible.map((row) => <tr data-testid="summary-row" className="border-b border-hairline" key={row.attempt_id}>
      <td className="p-3 tabular-nums">{ranks.get(row.attempt_id) ?? "—"}</td><td className="p-3">{row.is_absent ? row.mer_code : <Link className="underline" href={`/admin/results/${row.attempt_id}`}>{row.mer_code}</Link>}</td><td className="p-3">{row.full_name}</td><td className="p-3">{row.outlet ?? ""}</td><td className="p-3"><span className="inline-flex rounded-full border border-line bg-selected px-3 py-1 text-sm font-bold">{status(row)}</span>{row.is_absent ? <span className="block text-sm text-muted">Did not take the exam</span> : null}</td>
      <td className="p-3"><CandidateBadge merCode={row.mer_code} count={row.violations_counted} threshold={exam.flag_threshold} /><span className="block text-sm text-muted">{row.violations_logged} logged</span></td><td className="p-3 tabular-nums">{row.mcq_marks ?? ""}</td><td className="p-3 tabular-nums">{row.written_marks ?? ""}</td><td className="p-3 tabular-nums">{row.total_marks ?? ""}</td><td className="min-w-32 p-3 tabular-nums"><span>{formatPercent(row.total_percent)}</span>{row.total_percent === null ? null : <progress aria-label={`${row.mer_code} score`} className="mt-1 block w-full accent-ok" max={100} value={Math.max(0, Math.min(100, row.total_percent))}>{formatPercent(row.total_percent)}</progress>}</td><td className="p-3">{row.needs_review_count} to review</td><td className="p-3">{row.unscored_count}</td><td className="p-3"><span className={`inline-flex rounded-full border px-3 py-1 text-sm font-bold ${row.is_final ? "border-ok bg-ok-tint text-ok" : "border-warn bg-warn-tint text-warn"}`}>{row.is_final ? "Yes" : "Not final"}</span></td>
    </tr>)}</tbody></table></div>}
    <div>{notFinal > 0 ? <p className="mb-2 border-l-4 border-warning bg-warning-tint p-3">{notFinal} results are not final yet.</p> : null}<Link className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-5 font-bold" href={`/api/admin/results/export?exam_id=${encodeURIComponent(exam.id)}`}>Export CSV</Link></div>
  </section>;
}
