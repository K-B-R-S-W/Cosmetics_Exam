// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import { HealthDashboard } from "./HealthDashboard";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("HealthDashboard", () => {
  it("shows service words and resolves an alert", async () => {
    const alert = { id: "00000000-0000-4000-8000-000000000001", type: "worker", severity: "critical", message: "Worker down", created_at: new Date().toISOString(), resolved_at: null };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/admin/exams") return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes("/resolve")) return new Response(JSON.stringify({ resolved: true }), { status: 200 });
      return new Response(JSON.stringify({ checked_at: new Date().toISOString(), components: { supabase: { ok: true, latency_ms: 5 }, livekit: { ok: false, latency_ms: 9, room_count: null }, worker: { ok: false, status: "down", last_heartbeat_at: null, age_ms: null } }, keys: [], alerts: [alert] }), { status: 503 });
    }));
    render(<ToastProvider><HealthDashboard /></ToastProvider>);
    expect(await screen.findByText("Worker down")).toBeTruthy();
    expect(screen.getAllByText("Not responding")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Snapshot cleanup" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("No active alerts.")).toBeTruthy());
    expect(screen.getByText("Alert resolved.")).toBeTruthy();
  });

  it("keeps health-load errors inline", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => String(input) === "/api/admin/exams"
      ? new Response(JSON.stringify({ items: [] }), { status: 200 })
      : new Response("{}", { status: 500 })));
    render(<ToastProvider><HealthDashboard /></ToastProvider>);
    expect(await screen.findByText("Health status could not be loaded.")).toBeTruthy();
    expect(within(screen.getByTestId("toast-container")).queryByText("Health status could not be loaded.")).toBeNull();
  });

  it("shows failed resolve actions as persistent toasts", async () => {
    const alert = { id: "00000000-0000-4000-8000-000000000001", type: "worker", severity: "critical", message: "Worker down", created_at: new Date().toISOString(), resolved_at: null };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/admin/exams") return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url.includes("/resolve")) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ checked_at: new Date().toISOString(), components: { supabase: { ok: true, latency_ms: 5 }, livekit: { ok: true, latency_ms: 9, room_count: null }, worker: { ok: true, status: "healthy", last_heartbeat_at: null, age_ms: null } }, keys: [], alerts: [alert] }), { status: 200 });
    }));
    render(<ToastProvider><HealthDashboard /></ToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    expect(await within(screen.getByTestId("toast-container")).findByText("The alert could not be resolved.")).toBeTruthy();
    expect(screen.getByText("Worker down")).toBeTruthy();
    expect(screen.queryByText("The alert could not be resolved.", { selector: "section > p[role='alert']" })).toBeNull();
  });
});
