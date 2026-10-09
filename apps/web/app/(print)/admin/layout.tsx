import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminAuthError, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PrintAdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      const reason = error.code === "unauthenticated" ? "session-ended" : "not-configured";
      redirect(`/admin/login?reason=${reason}&returnTo=%2Fadmin`);
    }
    throw error;
  }

  return <div className="print-route min-w-0 w-full max-w-full overflow-visible">{children}</div>;
}
