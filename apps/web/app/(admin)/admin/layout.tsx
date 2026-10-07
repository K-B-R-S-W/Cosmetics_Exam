import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminAuthError, requireAdmin } from "@/lib/auth";
import type { HealthAlert } from "@/lib/admin-health";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let admin;

  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      const reason =
        error.code === "unauthenticated" ? "session-ended" : "not-configured";
      redirect(`/admin/login?reason=${reason}&returnTo=%2Fadmin`);
    }

    throw error;
  }

  let initialAlerts: HealthAlert[] = [];
  if (admin.role === "super_admin") {
    const { data, error } = await createServiceRoleClient().from("alerts").select("id,type,severity,message,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false });
    if (error) throw new Error("admin_alerts_load_failed");
    initialAlerts = (data ?? []) as HealthAlert[];
  }

  return (
    <div className="admin-shell grid min-h-dvh grid-cols-[12.5rem_minmax(0,1fr)] grid-rows-[3.5rem_minmax(0,1fr)] bg-paper">
      <AdminHeader admin={admin} initialAlerts={initialAlerts} />
      <AdminNav role={admin.role} />
      <main className="min-w-0 overflow-auto p-8">{children}</main>
    </div>
  );
}
