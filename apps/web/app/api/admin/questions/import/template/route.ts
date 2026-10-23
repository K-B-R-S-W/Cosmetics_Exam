import { apiErrorResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { csvTextCell } from "@/lib/csv";
import { QUESTION_IMPORT_COLUMNS } from "@/lib/question-import";

const ROUTE = "/api/admin/questions/import/template";

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    const mcq = ["mcq", "ශ්‍රී ලංකාවේ අගනුවර කුමක්ද?", "Colombo", "Sri Jayawardenepura Kotte", "", "", "", "", "", "", "", "", "B", "1", "", ""];
    const written = ["written", "Explain the answer.", "", "", "", "", "", "", "", "", "", "", "", "2", "A clear model answer", "Optional grading notes"];
    const rows = [QUESTION_IMPORT_COLUMNS.join(","), mcq.map(csvTextCell).join(","), written.map(csvTextCell).join(",")];
    return new Response(`\uFEFF${rows.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="question-import-template.csv"', "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
