import type { AdminRole } from "@/lib/auth";

const NAV_ITEMS = [
  { label: "Exams", superAdminOnly: false },
  { label: "Candidates", superAdminOnly: false },
  { label: "Live", superAdminOnly: false },
  { label: "Results", superAdminOnly: false },
  { label: "Health", superAdminOnly: true },
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
            <span
              aria-disabled="true"
              className="flex min-h-11 cursor-not-allowed items-center rounded-control px-3 text-md text-muted"
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
