import Link from "next/link";
import { HealthDashboard } from "@/components/admin/HealthDashboard";
import { AdminAuthError, requireSuperAdmin } from "@/lib/auth";

export default async function HealthPage() {
  try { await requireSuperAdmin(); }
  catch (error) {
    if (error instanceof AdminAuthError && error.code === "forbidden") return <section className="border-t border-hairline pt-6"><h2 className="text-title font-bold">You don&apos;t have access to this page.</h2><Link className="mt-6 inline-flex min-h-11 items-center rounded-control border border-ink px-5 font-bold" href="/admin/exams">Go to Exams</Link></section>;
    throw error;
  }
  return <HealthDashboard />;
}
