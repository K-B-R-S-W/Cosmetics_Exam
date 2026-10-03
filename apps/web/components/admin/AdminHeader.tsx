"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/admin/SignOutButton";
import type { AdminContext } from "@/lib/auth";

function pageName(pathname: string): string {
  if (pathname.startsWith("/admin/candidates")) return "Candidates";
  if (pathname.startsWith("/admin/live")) return "Live";
  if (pathname.startsWith("/admin/results")) return "Results";
  if (pathname.startsWith("/admin/health")) return "Health";
  if (pathname.startsWith("/admin/exams")) return "Exams";
  return "Administration";
}

export function AdminHeader({ admin }: { admin: AdminContext }) {
  const pathname = usePathname();

  return (
    <header className="col-span-2 flex h-14 items-center border-b border-hairline bg-surface px-5">
      <div className="flex w-50 shrink-0 items-center gap-4">
        <Image
          src="/brand/logo-ink.png"
          alt="Cosmetics.lk"
          width={201}
          height={187}
          className="h-7 w-auto"
          priority
        />
      </div>
      <h1 className="text-md font-bold text-ink">{pageName(pathname)}</h1>
      <div className="ml-auto flex items-center gap-5">
        <span className="min-w-20" aria-hidden="true" />
        <div className="text-right text-sm">
          <p className="font-bold text-ink">{admin.name}</p>
          <p className="text-muted">
            {admin.role === "super_admin" ? "Super admin" : "Admin"}
          </p>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
