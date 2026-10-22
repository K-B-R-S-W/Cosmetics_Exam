export interface AdminLandingExam {
  id: string;
  status: string;
  started_at: string | null;
}

export function adminLandingPath(exams: readonly AdminLandingExam[]): string {
  const liveExam = exams
    .filter((exam) => exam.status === "live")
    .sort((left, right) =>
      (left.started_at ?? "9999").localeCompare(right.started_at ?? "9999"),
    )[0];

  return liveExam
    ? `/admin/live?exam=${encodeURIComponent(liveExam.id)}`
    : "/admin/exams";
}
