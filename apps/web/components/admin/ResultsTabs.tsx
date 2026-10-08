import Link from "next/link";

export function ResultsTabs({ examId, active }: { examId: string; active: "grading" | "summary" }) {
  const tabs = [
    { id: "grading", label: "Grading", href: `/admin/results?exam=${encodeURIComponent(examId)}` },
    { id: "summary", label: "Summary", href: `/admin/results/summary?exam=${encodeURIComponent(examId)}` },
  ] as const;
  return <nav aria-label="Results views" className="my-5 flex gap-2 border-b border-line">
    {tabs.map((tab) => <Link key={tab.id} href={tab.href} aria-current={active === tab.id ? "page" : undefined} className={`min-h-11 px-4 py-2 font-bold ${active === tab.id ? "border-b-2 border-ink" : "text-muted"}`}>{tab.label}</Link>)}
  </nav>;
}
