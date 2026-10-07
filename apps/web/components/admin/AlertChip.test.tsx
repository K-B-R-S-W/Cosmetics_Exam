// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setAuth: vi.fn(), subscribe: vi.fn(), onAuth: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: () => ({
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "token" } } }), onAuthStateChange: (callback: (event: string, session: { access_token: string }) => void) => { mocks.onAuth(callback); return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  realtime: { setAuth: mocks.setAuth },
  channel: () => ({ on() { return this; }, subscribe: mocks.subscribe }),
  removeChannel: mocks.remove,
  from: () => ({ select: () => ({ is: () => ({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }),
}) }));
import { AlertChip } from "./AlertChip";
afterEach(cleanup);
describe("AlertChip", () => {
  it("shows counts and authenticates Realtime before subscribing", async () => {
    render(<AlertChip initialAlerts={[{ id: "1", type: "worker", severity: "critical", message: "Down", created_at: new Date().toISOString(), resolved_at: null }]} />);
    expect(screen.getByRole("link", { name: "1 alert, 1 critical" })).toBeTruthy();
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    expect(mocks.setAuth.mock.invocationCallOrder[0]).toBeLessThan(mocks.subscribe.mock.invocationCallOrder[0]!);
  });
});
