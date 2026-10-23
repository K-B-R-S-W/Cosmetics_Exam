// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/Toast";
import { AdminManager } from "./AdminManager";

const fetchMock = vi.fn();
const current = { id: "super-1", name: "Current", email: "current@example.com", role: "super_admin", disabled: false, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: null };
const other = { id: "admin-2", name: "Other", email: "other@example.com", role: "admin", disabled: false, created_at: "2026-10-01T00:00:00Z", last_sign_in_at: null };

beforeEach(() => {
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AdminManager", () => {
  it("shows the disable-session note and keeps self-lockout actions disabled", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [current, other] }), { status: 200 }));
    render(<ToastProvider><AdminManager currentAdminId={current.id} /></ToastProvider>);
    expect(await screen.findAllByText("A disabled admin loses access when their current session expires (up to about an hour).", { exact: true })).toHaveLength(2);
    expect(screen.getByRole("combobox", { name: "Role for Current" })).toHaveProperty("disabled", true);
    expect(screen.getAllByRole("button", { name: "Disable" })[0]).toHaveProperty("disabled", true);
  });

  it("creates an admin, sends the initial password once, and clears the field", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [current] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ item: other }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [current, other] }), { status: 200 }));
    render(<ToastProvider><AdminManager currentAdminId={current.id} /></ToastProvider>);
    await screen.findByText("Current (you)");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Other" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "other@example.com" } });
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "initial-pass-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Create admin" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({ password: "initial-pass-12" });
    expect(screen.getByLabelText("Initial password")).toHaveProperty("value", "");
  });

  it("opens password reset without exposing the entered password in the UI afterward", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [current, other] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changed: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [current, other] }), { status: 200 }));
    render(<ToastProvider><AdminManager currentAdminId={current.id} /></ToastProvider>);
    const buttons = await screen.findAllByRole("button", { name: "Reset password" });
    fireEvent.click(buttons[1]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("New password"), { target: { value: "reset-pass-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByDisplayValue("reset-pass-12")).toBeNull();
  });
});
