// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminLoginForm,
  LOGIN_MESSAGES,
  normalizeAdminReturnPath,
} from "@/components/admin/AdminLoginForm";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  }),
}));

afterEach(cleanup);

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signInWithPassword.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "admin@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("AdminLoginForm", () => {
  it("signs in and uses a safe admin return path", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    render(<AdminLoginForm returnTo="/admin/results?tab=review" />);

    fillAndSubmit();

    await waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: "admin@example.com",
        password: "secret",
      });
      expect(mocks.replace).toHaveBeenCalledWith(
        "/admin/results?tab=review",
      );
    });
  });

  it.each([
    { status: 400, code: "invalid_credentials" },
    { status: 400, code: "invalid_credentials", message: "wrong password" },
  ])("uses one message for any invalid credential", async (authError) => {
    mocks.signInWithPassword.mockResolvedValue({ error: authError });
    render(<AdminLoginForm />);

    fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toContain(
      LOGIN_MESSAGES.invalidCredentials,
    );
  });

  it("shows the rate-limit message", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { status: 429, code: "over_request_rate_limit" },
    });
    render(<AdminLoginForm />);

    fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toContain(
      LOGIN_MESSAGES.rateLimited,
    );
  });

  it("recovers from a network failure without logging credentials", async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error("network failed"));
    render(<AdminLoginForm />);

    fillAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toContain(
      LOGIN_MESSAGES.network,
    );
    expect(
      (screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("toggles password visibility with aria-pressed", () => {
    render(<AdminLoginForm />);
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: "Show" });

    expect(password.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(password.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("locally signs out an account without an admin profile", async () => {
    render(<AdminLoginForm reason="not-configured" />);

    expect(screen.getByRole("alert").textContent).toContain(
      LOGIN_MESSAGES.notConfigured,
    );
    await waitFor(() =>
      expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }),
    );
  });
});

describe("normalizeAdminReturnPath", () => {
  it.each([undefined, "https://attacker.example", "//attacker.example", "/administer"])(
    "falls back to /admin for %s",
    (value) => {
      expect(normalizeAdminReturnPath(value)).toBe("/admin");
    },
  );

  it("accepts only an internal admin path", () => {
    expect(normalizeAdminReturnPath("/admin/exams/one?tab=settings")).toBe(
      "/admin/exams/one?tab=settings",
    );
  });
});
