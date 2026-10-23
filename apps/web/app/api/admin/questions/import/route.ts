import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import {
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_BATCH_SIZE,
  QUESTION_IMPORT_LIMIT,
  prepareQuestionImport,
  type ExistingQuestionForImport,
  type QuestionImportIssue,
  type QuestionImportRow,
} from "@/lib/question-import";
import { saveQuestionArgs } from "@/lib/question-server";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;
const ROUTE = "/api/admin/questions/import";
const BODY_LIMIT = 12 * 1024 * 1024;
const importRowShape = Object.fromEntries(QUESTION_IMPORT_COLUMNS.map((column) => [column, z.string()])) as Record<(typeof QUESTION_IMPORT_COLUMNS)[number], z.ZodString>;
const bodySchema = z.object({
  exam_id: z.uuid(),
  rows: z.array(z.object({ source_row: z.number().int().min(2), ...importRowShape }).strict()).min(1).max(QUESTION_IMPORT_LIMIT),
  dry_run: z.boolean(),
  force_rows: z.array(z.number().int().min(2)).max(QUESTION_IMPORT_LIMIT).default([]),
}).strict().superRefine((value, context) => {
  if (!value.dry_run && value.rows.length > QUESTION_IMPORT_BATCH_SIZE) {
    context.addIssue({ code: "custom", path: ["rows"], message: `Confirmed batches may contain at most ${QUESTION_IMPORT_BATCH_SIZE} rows.` });
  }
});

async function readBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) throw new ApiError("payload_too_large", 413, "The import is too large.");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > BODY_LIMIT) throw new ApiError("payload_too_large", 413, "The import is too large.");
  try { return JSON.parse(raw) as unknown; }
  catch { throw new ApiError("validation_failed", 400, "Send a valid JSON body."); }
}

async function loadExisting(client: ReturnType<typeof createServiceRoleClient>): Promise<ExistingQuestionForImport[]> {
  const rows: ExistingQuestionForImport[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await client
      .from("questions")
      .select("exam_id,type,body_html,mcq_options(text_html),exams(title)")
      .order("id")
      .range(from, from + 999);
    if (error || !Array.isArray(data)) throw databaseUnavailable();
    for (const raw of data) {
      const row = raw as unknown as { exam_id: string; type: "mcq" | "written"; body_html: string; mcq_options: Array<{ text_html: string }> | null; exams: { title: string } | Array<{ title: string }> | null };
      const exam = Array.isArray(row.exams) ? row.exams[0] : row.exams;
      rows.push({ exam_id: row.exam_id, exam_title: exam?.title ?? "another exam", type: row.type, body_html: row.body_html, option_html: (row.mcq_options ?? []).map((option) => option.text_html) });
    }
    if (data.length < 1_000) return rows;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = bodySchema.parse(await readBody(request));
    const client = createServiceRoleClient();
    const { data: exam, error: examError } = await client.from("exams").select("id,status").eq("id", body.exam_id).maybeSingle();
    if (examError) throw databaseUnavailable();
    if (!exam) throw new ApiError("not_found", 404, "Exam not found.");
    if (!['draft', 'scheduled'].includes(exam.status)) throw new ApiError("exam_locked", 409, "This exam has started, so its questions cannot change.");

    const prepared = prepareQuestionImport(body.rows as QuestionImportRow[], body.exam_id, await loadExisting(client), new Set(body.force_rows));
    if (body.dry_run) return jsonResponse({ dry_run: true, ready: prepared.ready.map((item) => item.row), issues: prepared.issues });

    let imported = 0;
    const issues: QuestionImportIssue[] = [...prepared.issues];
    for (const item of prepared.ready) {
      const { error } = await client.rpc("save_question", saveQuestionArgs(item.document));
      if (error) {
        const code = String(error.message ?? "").trim();
        issues.push({ row: item.row, code: code === "exam_locked" ? "exam_locked" : "save_failed", message: code === "exam_locked" ? "The exam started before this row could be saved." : "This row could not be saved." });
        continue;
      }
      imported += 1;
    }
    if (imported > 0) await recordAdminAction(client, admin, "question_save", body.exam_id, { exam_id: body.exam_id, imported, failed: issues.length });
    return jsonResponse({ dry_run: false, imported, issues });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
