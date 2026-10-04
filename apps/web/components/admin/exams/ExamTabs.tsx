"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

export function ExamTabs({ examId, current, onNavigate }: { examId: string; current: "settings" | "candidates"; onNavigate?: (href: string) => void }) {
  function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (!onNavigate) return;
    event.preventDefault();
    onNavigate(href);
  }

  return (
    <nav className="mt-5 border-b border-hairline" aria-label="Exam sections">
      <ul className="flex gap-6">
        <li>
          <Link onClick={(event) => follow(event, `/admin/exams/${examId}`)} className={`inline-flex min-h-11 items-center border-b-2 font-bold ${current === "settings" ? "border-ink" : "border-transparent"}`} href={`/admin/exams/${examId}`}>Settings</Link>
        </li>
        <li><span aria-disabled="true" className="inline-flex min-h-11 cursor-not-allowed items-center border-b-2 border-transparent text-muted">Questions</span></li>
        <li>
          <Link onClick={(event) => follow(event, `/admin/exams/${examId}/candidates`)} className={`inline-flex min-h-11 items-center border-b-2 font-bold ${current === "candidates" ? "border-ink" : "border-transparent"}`} href={`/admin/exams/${examId}/candidates`}>Candidates</Link>
        </li>
      </ul>
    </nav>
  );
}
