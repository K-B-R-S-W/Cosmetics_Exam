// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    render(<HealthDashboard />);
    expect(await screen.findByText("Worker down")).toBeTruthy();
    expect(screen.getAllByText("Not responding")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Snapshot cleanup" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("No active alerts.")).toBeTruthy());
    expect(screen.getByRole("status").textContent).toBe("Alert resolved.");
  });
});
