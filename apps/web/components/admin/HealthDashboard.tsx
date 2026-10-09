"use client";

import { useCallback, useEffect, useState } from "react";
import { SnapshotCleanup } from "@/components/admin/SnapshotCleanup";
import { Button } from "@/components/ui/Button";
import type { AdminHealthBody, HealthAlert, KeyHealth } from "@/lib/admin-health";

function ageText(milliseconds: number | null): string {
  if (milliseconds === null) return "Never";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.floor(seconds / 60)} minutes ago`;
}

function keyStatus(key: KeyHealth): string {
  if (key.status === "active") return "Active";
  if (key.status === "disabled") return "Disabled";
  return key.cooldown_until ? `Cooling until ${new Date(key.cooldown_until).toLocaleString("en-LK", { timeZone: "Asia/Colombo" })}` : "Cooling";
}

export function HealthDashboard() {
  const [health, setHealth] = useState<AdminHealthBody>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch("/api/admin/health", { cache: "no-store" });
      const body = await response.json() as AdminHealthBody & { error?: { message?: string } };
      if (!body.components) throw new Error(body.error?.message ?? "Health status could not be loaded.");
      setHealth(body);
    } catch { setError("Health status could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(), 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(refresh); window.clearInterval(clock); };
  }, [load]);
  async function resolve(alert: HealthAlert) {
    const response = await fetch(`/api/admin/alerts/${alert.id}/resolve`, { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } });
    if (!response.ok) { setError("The alert could not be resolved."); return; }
    setHealth((current) => current ? { ...current, alerts: current.alerts.filter(({ id }) => id !== alert.id) } : current);
    setToast("Alert resolved.");
  }
  const checkedAge = health ? Math.max(0, now - Date.parse(health.checked_at)) : null;
  return <section className="border-t border-hairline pt-6"><div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-sm text-muted">Administration</p><h2 className="text-title font-bold">Health</h2>{health ? <p className="mt-2 text-sm text-muted">Last checked {ageText(checkedAge)}</p> : null}</div><Button variant="secondary" loading={loading} onClick={() => void load()}>Check now</Button></div>
    {error ? <p role="alert" className="mt-5 border-l-4 border-alert bg-alert-tint p-4">{error}</p> : null}{toast ? <p role="status" className="mt-5 border-l-4 border-ok bg-ok-tint p-4">{toast}</p> : null}
    {health ? <><table className="mt-6 w-full border-collapse bg-surface"><caption className="sr-only">Service health</caption><thead><tr className="border-b border-hairline text-left"><th className="p-3">Service</th><th className="p-3">Status</th><th className="p-3">Details</th></tr></thead><tbody>
      <tr className="border-b border-hairline"><th className="p-3 text-left">Supabase</th><td className="p-3 font-bold">{health.components.supabase.ok ? "OK" : "Not responding"}</td><td className="p-3">{health.components.supabase.latency_ms} ms</td></tr>
      <tr className="border-b border-hairline"><th className="p-3 text-left">LiveKit</th><td className="p-3 font-bold">{health.components.livekit.ok ? "OK" : "Not responding"}</td><td className="p-3">{health.components.livekit.latency_ms} ms{health.components.livekit.room_count === null ? "" : ` · ${health.components.livekit.room_count} rooms`}</td></tr>
      <tr className="border-b border-hairline"><th className="p-3 text-left">Worker</th><td className="p-3 font-bold">{health.components.worker.ok ? "OK" : "Not responding"}</td><td className="p-3">Last heartbeat {ageText(health.components.worker.age_ms)}</td></tr>
    </tbody></table>
    <h3 className="mt-8 text-question font-bold">Gemini keys</h3>{health.keys.length ? <table className="mt-3 w-full border-collapse bg-surface"><caption className="sr-only">Gemini key status</caption><thead><tr className="border-b border-hairline text-left"><th className="p-3">Key</th><th className="p-3">Status</th><th className="p-3">Last error</th><th className="p-3">Checked</th></tr></thead><tbody>{health.keys.map((key) => <tr key={key.label} className="border-b border-hairline"><th className="p-3 text-left">{key.label}</th><td className="p-3">{keyStatus(key)}</td><td className="p-3">{key.last_error ?? "—"}</td><td className="p-3">{new Date(key.updated_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo" })}</td></tr>)}</tbody></table> : <p className="mt-3 text-muted">No key data yet. The worker writes it every 30 seconds once it is running.</p>}
    <h3 className="mt-8 text-question font-bold">Active alerts</h3>{health.alerts.length ? <table className="mt-3 w-full border-collapse bg-surface"><caption className="sr-only">Active alerts</caption><thead><tr className="border-b border-hairline text-left"><th className="p-3">Severity</th><th className="p-3">Message</th><th className="p-3">Time</th><th className="p-3"><span className="sr-only">Actions</span></th></tr></thead><tbody>{health.alerts.map((alert) => <tr key={alert.id} className="border-b border-hairline"><td className="p-3 font-bold">{alert.severity === "critical" ? "⚠ Critical" : alert.severity === "warning" ? "⚠ Warning" : "Info"}</td><td className="p-3">{alert.message}</td><td className="p-3">{new Date(alert.created_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo" })}</td><td className="p-3"><Button variant="quiet" onClick={() => void resolve(alert)}>Resolve</Button></td></tr>)}</tbody></table> : <p className="mt-3 text-muted">No active alerts.</p>}</> : loading ? <p className="mt-6 text-muted">Checking services…</p> : null}
    <SnapshotCleanup />
  </section>;
}
