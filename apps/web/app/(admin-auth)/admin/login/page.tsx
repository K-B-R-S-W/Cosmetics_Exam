import Image from "next/image";

import {
  AdminLoginForm,
  type LoginReason,
} from "@/components/admin/AdminLoginForm";
import { normalizeAdminReturnPath } from "@/lib/admin-return-path";

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const rawReason = firstValue(params.reason);
  const reason: LoginReason | undefined =
    rawReason === "not-configured" || rawReason === "session-ended"
      ? rawReason
      : undefined;
  const returnTo = normalizeAdminReturnPath(firstValue(params.returnTo));

  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-6 py-8">
      <section className="w-full max-w-md" aria-labelledby="admin-sign-in-title">
        <Image
          src="/brand/logo-ink.png"
          alt="Cosmetics.lk"
          width={201}
          height={187}
          className="mb-8 h-10 w-auto"
          priority
        />
        <h1 id="admin-sign-in-title" className="text-title font-bold text-ink">
          Admin sign in
        </h1>
        <AdminLoginForm reason={reason} returnTo={returnTo} />
      </section>
    </main>
  );
}
