"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { examStatusLabel, formatColomboDateTime, type ExamItem } from "@/lib/exams";

export function ExamList() {
  const [items, setItems] = useState<ExamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/exams", { cache: "no-store", signal: controller.signal });
        const body = await response.json() as { items?: ExamItem[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Exams could not be loaded.");
        setItems(body.items ?? []);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") setError((loadError as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <section className="border-t border-hairline pt-6" aria-labelledby="exams-title">
      <div className="flex items-start justify-between gap-6">
        <div><p className="mb-2 text-sm text-muted">Administration</p><h1 id="exams-title" className="text-title font-bold">Exams</h1></div>
        <Link href="/admin/exams/new" className="inline-flex min-h-11 items-center rounded-control border border-ink bg-ink px-5 font-bold text-surface">New exam</Link>
      </div>
      {error ? <p role="alert" className="mt-5 border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}
      <div className="mt-6 overflow-x-auto border-y border-hairline bg-surface">
        <table className="w-full min-w-4xl border-collapse text-left">
          <thead><tr className="border-b border-hairline text-sm text-muted"><th className="px-3 py-3">Title</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Start</th><th className="px-3 py-3">Duration</th><th className="px-3 py-3">Questions</th><th className="px-3 py-3">Candidates</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">Loading exams…</td></tr> : null}
            {!loading && items.length === 0 ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted">No exams yet. Create the first one to add questions and candidates.</td></tr> : null}
            {items.map((exam) => {
              const href = exam.status === "live" ? `/admin/live?exam=${exam.id}` : ["ended", "finalized"].includes(exam.status) ? `/admin/results?exam=${exam.id}` : `/admin/exams/${exam.id}`;
              const action = exam.status === "live" ? "Open live view" : ["ended", "finalized"].includes(exam.status) ? "Results" : "Edit";
              return <tr key={exam.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-3 font-bold"><Link className="underline" href={`/admin/exams/${exam.id}`}>{exam.title}</Link>{exam.is_practice ? <span className="ml-2 border border-line px-2 py-1 text-xs">Practice</span> : null}</td>
                <td className="px-3 py-3">{examStatusLabel(exam.status)}</td><td className="px-3 py-3">{formatColomboDateTime(exam.scheduled_start_at)}</td><td className="px-3 py-3">{exam.duration_min} min</td><td className="px-3 py-3">{exam.question_count}</td><td className="px-3 py-3">{exam.assigned_count}</td>
                <td className="px-3 py-2 text-right"><Link href={href} className="inline-flex min-h-11 items-center rounded-control border border-line px-4 font-bold">{action}</Link></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
