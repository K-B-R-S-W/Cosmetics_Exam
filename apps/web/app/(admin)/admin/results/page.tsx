import { GradingProgress } from "@/components/admin/GradingProgress";
import { requireAdmin } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function ResultsPage({ searchParams }: { searchParams: Promise<{ exam_id?: string }> }) {
  await requireAdmin(); const client = createServiceRoleClient(); const { exam_id: requested } = await searchParams;
  const { data: exams } = await client.from("exams").select("id,title,status").order("created_at", { ascending: false });
  const examId = requested ?? exams?.[0]?.id; let attempts: Array<{ id: string; label: string }> = [];
  if (examId) { const { data } = await client.from("attempts").select("id,candidates!inner(mer_code,full_name)").eq("exam_id", examId).order("id"); attempts = (data ?? []).map((row) => { const candidate = row.candidates as unknown as { mer_code: string; full_name: string }; return { id: row.id, label: `${candidate.mer_code} — ${candidate.full_name}` }; }); }
  return <main><p className="text-muted">Administration</p><h1 className="text-title font-bold">Results</h1><form className="my-5"><label className="font-bold">Exam<select className="ml-3 min-h-11 border border-line px-3" name="exam_id" defaultValue={examId}>{exams?.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label><button className="ml-2 min-h-11 border border-line px-4">View</button></form>{examId ? <GradingProgress examId={examId} attempts={attempts} /> : <p>No exams yet.</p>}</main>;
}
