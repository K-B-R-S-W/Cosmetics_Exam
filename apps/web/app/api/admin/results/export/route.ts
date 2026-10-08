import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ApiError, apiErrorResponse } from "@/lib/api";
import { csvCell, csvTextCell } from "@/lib/csv";
import { loadResultsSummary } from "@/lib/grading/results-summary";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "GET /api/admin/results/export";
const HEADERS = ["mer_code", "full_name", "outlet", "attempt_status", "submit_reason", "violations_counted", "violations_logged", "questions_received", "mcq_marks", "written_marks", "total_marks", "total_percent", "needs_review_count", "unscored_count"];

function colomboDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function titleSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "exam";
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin();
    const examId = z.uuid().parse(new URL(request.url).searchParams.get("exam_id"));
    const summary = await loadResultsSummary(createServiceRoleClient(), examId);
    if (!summary) throw new ApiError("not_found", 404, "Exam not found.");
    const lines = [HEADERS.join(","), ...summary.rows.map((row) => [
      csvTextCell(row.mer_code), csvTextCell(row.full_name), csvTextCell(row.outlet), csvTextCell(row.attempt_status), csvTextCell(row.is_absent ? "" : row.submit_reason),
      csvCell(row.violations_counted), csvCell(row.violations_logged), csvTextCell(row.question_numbers.join(";")), csvCell(row.mcq_marks), csvCell(row.written_marks), csvCell(row.total_marks), csvCell(row.total_percent), csvCell(row.needs_review_count), csvCell(row.unscored_count),
    ].join(","))];
    const filename = `results-${titleSlug(summary.exam.title)}-${colomboDate()}.csv`;
    return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
