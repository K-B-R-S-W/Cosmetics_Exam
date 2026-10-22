import { redirect } from "next/navigation";

import { adminLandingPath, type AdminLandingExam } from "@/lib/admin-landing";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function AdminPage() {
  let target = "/admin/exams";

  try {
    const { data, error } = await createServiceRoleClient()
      .from("exams")
      .select("id, status, started_at")
      .eq("status", "live")
      .order("started_at", { ascending: true })
      .limit(1);

    if (error) throw error;
    target = adminLandingPath((data ?? []) as AdminLandingExam[]);
  } catch {
    target = "/admin/exams";
  }

  redirect(target);
}
