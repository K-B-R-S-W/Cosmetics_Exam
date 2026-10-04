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
