"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AttemptReviewData, AttemptReviewItem } from "@/lib/grading/attempt-review";
import { langFor } from "@/lib/lang";

type PrintData = NonNullable<AttemptReviewData["print"]>;

function formatExamDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-LK", { timeZone: "Asia/Colombo", year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

function marks(item: AttemptReviewItem): string {
  return item.score ? `${item.score.marks} / ${item.max_marks}` : "Not graded";
}

export function cssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replace(/[\n\r\f]/g, "\\a ")
    .replaceAll("<", "\\3c ")
    .replaceAll(">", "\\3e ")
    .replaceAll("&", "\\26 ")
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, "");
}

export function PrintResult({ attemptId, candidate, print, items }: { attemptId: string; candidate: AttemptReviewData["candidate"]; print: PrintData; items: AttemptReviewItem[] }) {
  const [includeModels, setIncludeModels] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  return <article className="print-result bg-surface text-ink">
    <style data-print-page>{`@page candidate-result { @bottom-left { content: "${cssString(`${candidate.full_name} · ${candidate.mer_code}`)}"; font-size: 9pt; } }`}</style>
    <div className="print-controls mb-6 flex flex-wrap items-center gap-3 border-b border-line pb-4">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeModels} onChange={(event) => setIncludeModels(event.target.checked)} /> Include model answers</label>
      <Button onClick={() => window.print()}>Print or save as PDF</Button>
      <Link className="inline-flex min-h-11 items-center rounded-control border border-line px-5 font-bold" href={`/admin/results/${attemptId}`}>Back</Link>
    </div>
    <header className="mb-6 border-b border-ink pb-4">
      <h1 className="text-title font-bold" lang={langFor(print.exam_title)}>{print.exam_title}</h1>
      <p>{formatExamDate(print.exam_date)}</p>
      <h2 className="mt-4 text-question font-bold" lang={langFor(candidate.full_name)}>{candidate.full_name}</h2>
      <p>{candidate.mer_code}{candidate.outlet ? ` · ${candidate.outlet}` : ""}</p>
      <p className="mt-3 font-bold">Total {print.earned_marks ?? "—"} / {print.max_marks ?? "—"} ({print.total_percent === null ? "—" : print.total_percent.toFixed(1)}%)</p>
      <p className="font-bold">{print.is_final ? "Final" : "Not final"}</p>
    </header>
    <div className="space-y-5">{items.map((item) => {
      const imageFailed = failedImages.has(item.question_id) || item.image?.image_missing;
      const verdict = !item.selected_option ? "No answer" : item.selected_correct ? "Correct" : "Incorrect";
      return <section className="print-question border border-ink p-4" key={item.question_id}>
        <h2 className="text-question font-bold">Question {item.paper_number} <span className="text-sm font-normal">(question {item.admin_number} in the exam)</span></h2>
        <p className="mt-2 font-bold" lang={langFor(item.question)}>{item.question}</p>
        {item.image ? imageFailed || !item.image.url ? <p className="mt-3 font-bold">Image unavailable</p> :
          // Signed private images have no stable host or stored dimensions; preserve the source file for printing.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="print-question-image mt-3 max-h-96 w-auto object-contain" src={item.image.url} alt={item.image.alt_text} loading="eager" onError={() => setFailedImages((current) => new Set(current).add(item.question_id))} /> : null}
        {item.type === "mcq" ? <div className="mt-4 space-y-2">
          <p><strong>Candidate answer:</strong> {item.selected_option ? `${item.selected_option.label}. ${item.selected_option.text}` : "No answer"}</p>
          <p><strong>Verdict:</strong> {verdict}</p>
          <p><strong>Marks:</strong> {marks(item)}</p>
          <p><strong>Source:</strong> MCQ</p>
          {includeModels ? <p><strong>Correct option:</strong> {item.correct_option ? `${item.correct_option.label}. ${item.correct_option.text}` : "Not available"}</p> : null}
        </div> : <div className="mt-4 space-y-2">
          <p><strong>Candidate answer:</strong></p><p className="whitespace-pre-wrap" lang={langFor(item.answer)}>{item.answer || "No answer"}</p>
          <p><strong>Marks:</strong> {marks(item)}</p>
          {item.score ? <p><strong>Source:</strong> {item.score.source === "override" ? "Override" : "AI"}</p> : null}
          {item.score?.reason ? <p><strong>Reason:</strong> {item.score.reason}</p> : null}
          {item.score?.needs_review ? <p className="font-bold">Needs review</p> : null}
          {includeModels ? <p><strong>Model answer:</strong> <span className="whitespace-pre-wrap" lang={langFor(item.model_answer)}>{item.model_answer || "Not available"}</span></p> : null}
        </div>}
      </section>;
    })}</div>
  </article>;
}
