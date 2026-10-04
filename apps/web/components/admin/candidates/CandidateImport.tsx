"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  candidateImportBatches,
  repeatedMerIndexes,
  type IndexedCandidateImportRow,
} from "@/lib/candidate-csv";
import type { CandidateImportError, CandidateImportRow } from "@/lib/candidates";
import { normalizeMer } from "@/lib/mer";

type Step = "choose" | "check" | "import";
type DuplicateStrategy = "skip" | "update";

interface ImportResponse {
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: CandidateImportError[];
  error?: { message?: string };
}

interface CheckSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: CandidateImportError[];
  validRows: IndexedCandidateImportRow[];
}

const REQUIRED_COLUMNS = ["mer_code", "full_name", "outlet", "nic"];

export function CandidateImport() {
  const [step, setStep] = useState<Step>("choose");
  const [rows, setRows] = useState<CandidateImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [strategy, setStrategy] = useState<DuplicateStrategy>("skip");
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<CheckSummary>();
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState<{ created: number; updated: number; skipped: number }>();
  const [error, setError] = useState<string>();

  function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setSummary(undefined);
    setFinished(undefined);
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim().toLowerCase(),
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        const missing = REQUIRED_COLUMNS.filter((column) => !fields.includes(column));
        if (missing.length > 0) {
          setRows([]);
          setError(`Missing CSV column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
          return;
        }
        if (result.errors.length > 0) {
          setRows([]);
          setError(result.errors[0]?.message ?? "The CSV could not be read.");
          return;
        }

        setRows(
          result.data.map((row) => ({
            mer_code: row.mer_code ?? "",
            full_name: row.full_name ?? "",
            outlet: row.outlet ?? "",
            nic: row.nic ?? "",
          })),
        );
        setStep("choose");
      },
      error: () => {
        setRows([]);
        setError("The CSV could not be read.");
      },
    });
  }

  async function sendBatch(
    batch: IndexedCandidateImportRow[],
    dryRun: boolean,
  ): Promise<ImportResponse> {
    const response = await fetch("/api/admin/candidates/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: batch.map((item) => item.row),
        on_duplicate: strategy,
        dry_run: dryRun,
      }),
    });
    const body = (await response.json()) as ImportResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? "This batch could not be processed.");
    }
    return body;
  }

  async function checkFile() {
    setChecking(true);
    setError(undefined);
    setFinished(undefined);

    try {
      const repeated = repeatedMerIndexes(rows);
      const localErrors: CandidateImportError[] = [...repeated].map((index) => ({
        row: index + 2,
        mer_code: normalizeMer(rows[index]?.mer_code ?? ""),
        code: "duplicate_mer_in_batch",
        message: "This MER code is repeated earlier in the file.",
      }));
      const prepared = rows
        .map((row, sourceIndex) => ({ sourceIndex, row }))
        .filter((item) => !repeated.has(item.sourceIndex));
      const totals = { created: 0, updated: 0, skipped: 0 };
      const serverErrors: CandidateImportError[] = [];
      const invalidIndexes = new Set<number>();

      for (const batch of candidateImportBatches(prepared)) {
        const result = await sendBatch(batch, true);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += result.skipped;

        for (const item of result.errors) {
          const source = batch[item.row - 1];
          if (!source) continue;
          invalidIndexes.add(source.sourceIndex);
          serverErrors.push({ ...item, row: source.sourceIndex + 2 });
        }
      }

      setSummary({
        ...totals,
        errors: [...localErrors, ...serverErrors].sort((a, b) => a.row - b.row),
        validRows: prepared.filter((item) => !invalidIndexes.has(item.sourceIndex)),
      });
      setStep("check");
    } catch (checkError) {
      setError((checkError as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function importRows() {
    if (!summary) return;
    setImporting(true);
    setError(undefined);
    setProgress(0);
    const totals = { created: 0, updated: 0, skipped: 0 };
    let processed = 0;

    try {
      for (const batch of candidateImportBatches(summary.validRows)) {
        const result = await sendBatch(batch, false);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
        processed += batch.length;
        setProgress(processed);
      }
      setFinished(totals);
      setStep("import");
    } catch {
      setError(`The import stopped after ${processed} rows. Nothing after that was saved. Fix the problem and run the file again with "Skip" selected.`);
    } finally {
      setImporting(false);
    }
  }

  const importCount = (summary?.created ?? 0) + (summary?.updated ?? 0);

  return (
    <section className="border-t border-hairline pt-6" aria-labelledby="candidate-import-title">
      <p className="mb-2 text-sm text-muted">Candidates</p>
      <h1 id="candidate-import-title" className="text-title font-bold">Import CSV</h1>

      <ol className="mt-6 flex max-w-2xl gap-2" aria-label="Import steps">
        {(["choose", "check", "import"] as Step[]).map((item, index) => (
          <li key={item} className={`flex-1 border-t-4 pt-2 text-sm font-bold ${step === item ? "border-ink text-ink" : "border-hairline text-muted"}`}>
            {index + 1} {item === "choose" ? "Choose file" : item === "check" ? "Check" : "Import"}
          </li>
        ))}
      </ol>

      {error ? <p role="alert" className="mt-5 max-w-3xl border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}

      <div className="mt-6 max-w-4xl">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line bg-surface px-5 font-bold hover:bg-selected">
            Choose CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
          </label>
          <a
            download="candidate-import-template.csv"
            href="data:text/csv;charset=utf-8,mer_code%2Cfull_name%2Coutlet%2Cnic%0A"
            className="font-bold text-ink underline"
          >
            Download template
          </a>
          {fileName ? <span className="text-muted">{fileName}</span> : null}
        </div>
        <p className="mt-3 text-sm text-muted">Save from Excel as <strong>CSV UTF-8</strong> so Sinhala names stay correct.</p>
        <p className="mt-3 border-l-4 border-warn bg-warn-tint px-4 py-3">The file contains ID numbers. Delete it from your computer after importing.</p>

        {rows.length > 0 ? (
          <>
            <p className="mt-5 font-bold">{rows.length} row{rows.length === 1 ? "" : "s"}</p>
            <div className="mt-3 overflow-x-auto border-y border-hairline bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead><tr className="border-b border-hairline"><th className="p-2">MER code</th><th className="p-2">Full name</th><th className="p-2">Outlet</th><th className="p-2">ID number</th></tr></thead>
                <tbody>{rows.slice(0, 10).map((row, index) => (
                  <tr key={index} className="border-b border-hairline last:border-0"><td className="p-2">{row.mer_code}</td><td className="p-2">{row.full_name}</td><td className="p-2">{row.outlet}</td><td className="p-2">{row.nic}</td></tr>
                ))}</tbody>
              </table>
            </div>

            <fieldset className="mt-6">
              <legend className="font-bold">If a MER code already exists:</legend>
              <div className="mt-2 flex gap-6">
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="strategy" value="skip" checked={strategy === "skip"} onChange={() => { setStrategy("skip"); setSummary(undefined); setStep("choose"); }} /> Skip it</label>
                <label className="flex min-h-11 items-center gap-2"><input type="radio" name="strategy" value="update" checked={strategy === "update"} onChange={() => { setStrategy("update"); setSummary(undefined); setStep("choose"); }} /> Update it</label>
              </div>
            </fieldset>
            <Button className="mt-4" loading={checking} onClick={() => void checkFile()}>Check file</Button>
          </>
        ) : null}

        {summary ? (
          <div className="mt-8 border-t border-hairline pt-6">
            <h2 className="text-question font-bold">Check</h2>
            <p className="mt-3">{summary.created} will be added, {summary.updated} will be updated, {summary.skipped} skipped, {summary.errors.length} have errors.</p>
            {summary.errors.length > 0 ? (
              <div className="mt-4 overflow-x-auto border-y border-hairline bg-surface">
                <table className="w-full border-collapse text-left"><thead><tr className="border-b border-hairline"><th className="p-2">Row</th><th className="p-2">MER code</th><th className="p-2">Problem</th></tr></thead>
                  <tbody>{summary.errors.map((item, index) => <tr key={`${item.row}-${index}`} className="border-b border-hairline last:border-0"><td className="p-2">{item.row}</td><td className="p-2">{item.mer_code || "—"}</td><td className="p-2">{item.message}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null}
            <Button className="mt-5" disabled={importCount === 0} loading={importing} onClick={() => void importRows()}>Import {importCount} candidates</Button>
            {importing ? <p role="status" className="mt-3">Imported {progress} of {summary.validRows.length}</p> : null}
          </div>
        ) : null}

        {finished ? (
          <div className="mt-8 border-l-4 border-ok bg-ok-tint px-4 py-4">
            <h2 className="font-bold">Done.</h2>
            <p>{finished.created} added, {finished.updated} updated, {finished.skipped} skipped.</p>
            <Link href="/admin/candidates" className="mt-3 inline-block font-bold text-ink underline">Back to candidates</Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
