import { ResultsSummary } from "@/components/admin/ResultsSummary";
import { ResultsTabs } from "@/components/admin/ResultsTabs";
import { requireAdmin } from "@/lib/auth";
import { loadResultsSummary, resolveResultsExamParam } from "@/lib/grading/results-summary";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function ResultsSummaryPage({ searchParams }: { searchParams: Promise<{ exam?: string; exam_id?: string }> }) {
  await requireAdmin();
  const client = createServiceRoleClient();
  const requested = resolveResultsExamParam(await searchParams);
  const { data: exams, error: examsError } = await client.from("exams").select("id,title,status").in("status", ["ended", "finalized"]).order("created_at", { ascending: false });
  const examId = requested ?? exams?.[0]?.id;
  let summary = null;
  let unavailable = Boolean(examsError);
  if (examId && !unavailable) {
    try { summary = await loadResultsSummary(client, examId); }
    catch { unavailable = true; }
  }
  return <main><p className="text-muted">Administration</p><h1 className="text-title font-bold">Results</h1><form className="my-5"><label className="font-bold">Exam<select className="ml-3 min-h-11 border border-line px-3" name="exam" defaultValue={examId}>{exams?.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label><button className="ml-2 min-h-11 border border-line px-4">View</button></form>{unavailable ? <p role="alert">Results are unavailable.</p> : summary ? <><ResultsTabs examId={summary.exam.id} active="summary" /><ResultsSummary {...summary} /></> : <p>{examId ? "Results are unavailable." : "No exams yet."}</p>}</main>;
}
