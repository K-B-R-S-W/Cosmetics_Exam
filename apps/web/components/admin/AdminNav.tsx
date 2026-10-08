import Link from "next/link";

import type { AdminRole } from "@/lib/auth";

const NAV_ITEMS = [
  { label: "Exams", href: "/admin/exams", superAdminOnly: false },
  { label: "Candidates", href: "/admin/candidates", superAdminOnly: false },
  { label: "Live", href: "/admin/live", superAdminOnly: false },
  { label: "Results", href: "/admin/results", superAdminOnly: false },
  { label: "Health", href: "/admin/health", superAdminOnly: true },
] as const;

export function AdminNav({ role }: { role: AdminRole }) {
  return (
    <nav
      className="w-50 border-r border-hairline bg-surface px-3 py-5"
      aria-label="Administration"
    >
      <ul className="space-y-1">
        {NAV_ITEMS.filter(
          (item) => !item.superAdminOnly || role === "super_admin",
        ).map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="flex min-h-11 items-center rounded-control px-3 text-md text-ink hover:bg-selected"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
