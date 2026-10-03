"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export const LOGIN_MESSAGES = {
  invalidCredentials: "Email or password is not correct.",
  notConfigured:
    "This account is not set up as an admin. Ask the super admin to add you.",
  sessionEnded: "You were signed out. Sign in again.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  network: "Can't reach the server. Check the connection and try again.",
} as const;

export type LoginReason = "not-configured" | "session-ended";

export function normalizeAdminReturnPath(value: string | undefined): string {
  if (!value || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
    return "/admin";
  }

  if (
    value === "/admin" ||
    value.startsWith("/admin/") ||
    value.startsWith("/admin?")
  ) {
    return value;
  }

  return "/admin";
}

interface AdminLoginFormProps {
  reason?: LoginReason;
  returnTo?: string;
}

export function AdminLoginForm({ reason, returnTo }: AdminLoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>(
    reason === "not-configured"
      ? LOGIN_MESSAGES.notConfigured
      : reason === "session-ended"
        ? LOGIN_MESSAGES.sessionEnded
        : undefined,
  );
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [clearingSession, setClearingSession] = useState(
    reason === "not-configured",
  );

  useEffect(() => {
    if (reason !== "not-configured") {
      return;
    }

    let active = true;
    const supabase = createBrowserSupabaseClient();

    void supabase.auth.signOut({ scope: "local" }).finally(() => {
      if (active) {
        setClearingSession(false);
      }
    });

    return () => {
      active = false;
    };
  }, [reason]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const supabase = createBrowserSupabaseClient();
    let signInError: { code?: string; status?: number } | null;

    try {
      ({ error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      }));
    } catch {
      setError(LOGIN_MESSAGES.network);
      setLoading(false);
      return;
    }

    if (signInError) {
      const isRateLimited =
        signInError.status === 429 || signInError.code?.includes("rate_limit");
      setError(
        isRateLimited
          ? LOGIN_MESSAGES.rateLimited
          : LOGIN_MESSAGES.invalidCredentials,
      );
      setLoading(false);
      return;
    }

    router.replace(normalizeAdminReturnPath(returnTo));
    router.refresh();
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <Field
        id="admin-email"
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        disabled={clearingSession || loading}
      />
      <Field
        id="admin-password"
        label="Password"
        name="password"
        type={showPassword ? "text" : "password"}
        autoComplete="current-password"
        required
        disabled={clearingSession || loading}
        trailingControl={
          <button
            type="button"
            className="min-h-11 px-3 text-sm font-bold text-ink hover:underline"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        }
      />
      {error ? (
        <p className="border-l-4 border-alert bg-alert-tint px-4 py-3 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        loading={loading}
        disabled={clearingSession}
      >
        Sign in
      </Button>
    </form>
  );
}
