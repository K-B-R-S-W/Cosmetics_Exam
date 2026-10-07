"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HealthAlert } from "@/lib/admin-health";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function AlertChip({ initialAlerts }: { initialAlerts: HealthAlert[] }) {
  const [alerts, setAlerts] = useState(initialAlerts);
  useEffect(() => {
    const client = createBrowserSupabaseClient();
    let active = true;
    let channel: ReturnType<typeof client.channel> | undefined;
    let authSubscription: { unsubscribe(): void } | undefined;
    const refresh = async () => {
      const { data, error } = await client.from("alerts").select("id,type,severity,message,created_at,resolved_at").is("resolved_at", null).order("created_at", { ascending: false });
      if (active && !error) setAlerts((data ?? []) as HealthAlert[]);
    };
    void client.auth.getSession().then(({ data }) => {
      if (!active || !data.session?.access_token) return;
      client.realtime.setAuth(data.session.access_token);
      channel = client.channel("admin-alert-chip").on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => void refresh()).subscribe();
      authSubscription = client.auth.onAuthStateChange((event, session) => {
        if (event === "TOKEN_REFRESHED" && session?.access_token) client.realtime.setAuth(session.access_token);
      }).data.subscription;
    });
    return () => { active = false; authSubscription?.unsubscribe(); if (channel) void client.removeChannel(channel); };
  }, []);
  if (alerts.length === 0) return null;
  const critical = alerts.filter(({ severity }) => severity === "critical").length;
  return <Link href="/admin/health" className="min-h-11 rounded-control border border-alert px-3 py-2 text-sm font-bold text-alert">{alerts.length} {alerts.length === 1 ? "alert" : "alerts"}{critical ? `, ${critical} critical` : ""}</Link>;
}
