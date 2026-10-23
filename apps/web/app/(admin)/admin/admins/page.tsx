import Link from "next/link";

import { AdminManager } from "@/components/admin/AdminManager";
import { AdminAuthError, requireSuperAdmin } from "@/lib/auth";

export default async function AdminsPage() {
  let currentAdminId: string | null = null;
  let forbidden = false;
  try {
    currentAdminId = (await requireSuperAdmin()).id;
  } catch (error) {
    if (error instanceof AdminAuthError && error.code === "forbidden") forbidden = true;
    else throw error;
  }
  if (forbidden || !currentAdminId) return <section className="border-t border-hairline pt-6"><h1 className="text-title font-bold">You don&apos;t have access to this page.</h1><Link className="mt-6 inline-flex min-h-11 items-center rounded-control border border-ink px-5 font-bold" href="/admin/exams">Go to Exams</Link></section>;
  return <AdminManager currentAdminId={currentAdminId} />;
}
