"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_LIMIT,
  questionImportBatches,
  type QuestionImportIssue,
  type QuestionImportRow,
} from "@/lib/question-import";

type Preview = { ready: number[]; issues: QuestionImportIssue[] };

export function QuestionImport({ examId }: { examId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<QuestionImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [forceRows, setForceRows] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState<{ imported: number; issues: QuestionImportIssue[] }>();

  const damagedRows = useMemo(() => rows.filter((row) => QUESTION_IMPORT_COLUMNS.some((column) => {
    const value = row[column];
    return value.includes("\uFFFD") || /\?{3,}/.test(value);
  })).map((row) => row.source_row), [rows]);

  function choose(file: File | undefined) {
    if (!file) return;
    setFileName(file.name); setRows([]); setPreview(undefined); setForceRows(new Set()); setFinished(undefined); setError(undefined);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim().toLowerCase(),
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        const missing = QUESTION_IMPORT_COLUMNS.filter((column) => !fields.includes(column));
        if (missing.length) { setError(`Missing CSV columns: ${missing.join(", ")}.`); return; }
        if (result.errors.length) { setError(result.errors[0]?.message ?? "The CSV could not be read."); return; }
        if (result.data.length > QUESTION_IMPORT_LIMIT) { setError(`Import no more than ${QUESTION_IMPORT_LIMIT} rows at a time.`); return; }
        setRows(result.data.map((raw, index) => Object.assign(
          { source_row: index + 2 },
          Object.fromEntries(QUESTION_IMPORT_COLUMNS.map((column) => [column, raw[column] ?? ""])),
        ) as unknown as QuestionImportRow));
      },
      error: () => setError("The CSV could not be read."),
    });
  }

  async function send(batch: QuestionImportRow[], dryRun: boolean) {
    const response = await fetch("/api/admin/questions/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam_id: examId, rows: batch, dry_run: dryRun, force_rows: [...forceRows] }),
    });
    const body = await response.json() as { ready?: number[]; imported?: number; issues?: QuestionImportIssue[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "The question import could not be processed.");
    return body;
  }

  async function check() {
    setBusy(true); setError(undefined); setFinished(undefined);
    try {
      const result = await send(rows, true);
      setPreview({ ready: result.ready ?? [], issues: result.issues ?? [] });
    } catch (checkError) { toast.error((checkError as Error).message); }
    finally { setBusy(false); }
  }

  async function importRows() {
    if (!preview) return;
    const issuesByRow = new Map(preview.issues.map((item) => [item.row, item]));
    const selected = rows.filter((row) => {
      const problem = issuesByRow.get(row.source_row);
      return !problem || (problem.can_force && forceRows.has(row.source_row));
    });
    setBusy(true); setProgress(0);
    let imported = 0;
    let processed = 0;
    const issues: QuestionImportIssue[] = [];
    try {
      for (const batch of questionImportBatches(selected)) {
        const result = await send(batch, false);
        imported += result.imported ?? 0;
        issues.push(...(result.issues ?? []));
        processed += batch.length;
        setProgress(processed);
      }
      setFinished({ imported, issues });
      if (issues.length) toast.error(`Question import completed with ${issues.length} failed row${issues.length === 1 ? "" : "s"}. Earlier rows remain saved.`);
      else toast.success("Question import completed.");
    } catch {
      toast.error(`The import stopped after ${processed} rows. Earlier rows remain saved; nothing after that was attempted.`);
    } finally { setBusy(false); }
  }

  const selectedCount = preview ? rows.filter((row) => {
    const problem = preview.issues.find((item) => item.row === row.source_row);
    return !problem || (problem.can_force && forceRows.has(row.source_row));
  }).length : 0;

  return <section className="border-t border-hairline pt-6" aria-labelledby="question-import-title">
    <p className="mb-2 text-sm text-muted">Exams</p><h1 id="question-import-title" className="text-title font-bold">Import questions</h1>
    <div className="mt-6 flex flex-wrap items-center gap-4"><label className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line bg-surface px-5 font-bold">Choose CSV<input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => choose(event.target.files?.[0])} /></label><a className="font-bold underline" href="/api/admin/questions/import/template" download>Download template</a>{fileName ? <span className="text-muted">{fileName}</span> : null}</div>
    <p className="mt-3 text-sm text-muted">Save as CSV UTF-8 so Sinhala text remains intact. Files may mix MCQ and written questions.</p>
    {error ? <p role="alert" className="mt-4 border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}
    {damagedRows.length ? <p role="alert" className="mt-4 border-l-4 border-alert bg-alert-tint px-4 py-3">This file may contain damaged text in CSV rows {damagedRows.join(", ")}. Re-save it as CSV UTF-8.</p> : null}
    {rows.length ? <div className="mt-6"><p className="font-bold">{rows.length} rows loaded.</p><Button className="mt-3" loading={busy && !preview} disabled={damagedRows.length > 0} onClick={() => void check()}>Check file</Button></div> : null}
    {preview ? <div className="mt-8 border-t border-hairline pt-6"><h2 className="text-question font-bold">Dry-run preview</h2><p className="mt-2">{preview.ready.length} ready, {preview.issues.length} need attention. Nothing has been saved.</p>{preview.issues.length ? <div className="mt-4 overflow-x-auto"><table className="w-full border-collapse text-left"><thead><tr><th className="p-2">Row</th><th className="p-2">Problem</th><th className="p-2">Decision</th></tr></thead><tbody>{preview.issues.map((item) => <tr className="border-t border-hairline" key={`${item.row}-${item.code}`}><td className="p-2">{item.row}</td><td className="p-2">{item.message}{item.matching_exam ? ` (${item.matching_exam})` : ""}</td><td className="p-2">{item.can_force ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={forceRows.has(item.row)} onChange={(event) => setForceRows((current) => { const next = new Set(current); if (event.target.checked) next.add(item.row); else next.delete(item.row); return next; })} /> Import anyway</label> : "Fix or skip"}</td></tr>)}</tbody></table></div> : null}<Button className="mt-5" loading={busy} disabled={selectedCount === 0} onClick={() => void importRows()}>Import {selectedCount} questions</Button>{busy ? <p className="mt-2" role="status">Processed {progress} of {selectedCount}</p> : null}</div> : null}
    {finished ? <div className="mt-8 border-l-4 border-ok bg-ok-tint p-4"><p className="font-bold">Done. {finished.imported} imported.</p>{finished.issues.length ? <p>{finished.issues.length} rows failed and were not saved.</p> : null}<Link className="mt-3 inline-block font-bold underline" href={`/admin/exams/${examId}/questions`}>Back to questions</Link></div> : null}
  </section>;
}
