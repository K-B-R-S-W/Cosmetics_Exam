"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { AdminDirectoryItem } from "@/lib/admins";

type Role = "admin" | "super_admin";
type ErrorBody = { error?: { message?: string } };

export function AdminManager({ currentAdminId }: { currentAdminId: string }) {
  const toast = useToast();
  const resetDialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<AdminDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [password, setPassword] = useState("");
  const [resetTarget, setResetTarget] = useState<AdminDirectoryItem>();
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/admins", { cache: "no-store" });
    const body = await response.json() as { items?: AdminDirectoryItem[] } & ErrorBody;
    if (!response.ok) throw new Error(body.error?.message ?? "Admin accounts could not be loaded.");
    setItems(body.items ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); }
      catch (error) { setLoadError((error as Error).message); }
      finally { setLoading(false); }
    })();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, password }),
      });
      const body = await response.json() as ErrorBody;
      if (!response.ok) throw new Error(body.error?.message ?? "The admin could not be created.");
      setName(""); setEmail(""); setRole("admin"); setPassword("");
      await load();
      toast.success("Admin created. The initial password has been cleared.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function update(target: AdminDirectoryItem, body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(target.id);
    try {
      const response = await fetch(`/api/admin/admins/${target.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as ErrorBody;
      if (!response.ok) throw new Error(result.error?.message ?? "The admin could not be changed.");
      await load();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function reset() {
    if (!resetTarget) return;
    if (await update(resetTarget, { action: "reset_password", password: resetPassword }, "Password reset.")) {
      setResetPassword(""); setResetTarget(undefined); resetDialog.current?.close();
    }
  }

  return <section className="border-t border-hairline pt-6" aria-labelledby="admins-title">
    <p className="mb-2 text-sm text-muted">Super admin</p><h1 id="admins-title" className="text-title font-bold">Admins</h1>
    {loadError ? <p role="alert" className="mt-5 border-l-4 border-alert bg-alert-tint px-4 py-3">{loadError}</p> : null}
    <form className="mt-6 grid max-w-3xl gap-4 border border-hairline bg-surface p-5 md:grid-cols-2" onSubmit={(event) => void create(event)}>
      <h2 className="text-question font-bold md:col-span-2">Create admin</h2>
      <Field id="admin-name" label="Name" value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} />
      <Field id="admin-email" label="Email" type="email" value={email} maxLength={254} required onChange={(event) => setEmail(event.target.value)} />
      <label className="font-bold" htmlFor="admin-role">Role<select id="admin-role" className="mt-2 min-h-11 w-full rounded-control border border-line bg-surface px-3 font-normal" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></label>
      <Field id="admin-password" label="Initial password" type="password" value={password} minLength={12} maxLength={128} required onChange={(event) => setPassword(event.target.value)} />
      <p className="text-sm text-muted md:col-span-2">Use at least 12 characters. The password is sent only to Auth and is cleared from this form after creation.</p>
      <div className="md:col-span-2"><Button type="submit" loading={busy === "create"}>Create admin</Button></div>
    </form>
    <div className="mt-6 overflow-x-auto border-y border-hairline bg-surface"><table className="w-full min-w-5xl border-collapse text-left"><thead><tr className="border-b border-hairline text-sm text-muted"><th className="px-3 py-3">Name</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>
      {loading ? <tr><td className="px-3 py-8 text-center text-muted" colSpan={5}>Loading admins…</td></tr> : null}
      {items.map((item) => <tr key={item.id} className="border-b border-hairline last:border-0"><td className="px-3 py-3 font-bold">{item.name}{item.id === currentAdminId ? " (you)" : ""}</td><td className="px-3 py-3">{item.email}</td><td className="px-3 py-3"><select aria-label={`Role for ${item.name}`} className="min-h-11 rounded-control border border-line bg-surface px-3" disabled={busy === item.id || item.id === currentAdminId} value={item.role} onChange={(event) => void update(item, { action: "role", role: event.target.value }, "Role changed.")}><option value="admin">Admin</option><option value="super_admin">Super admin</option></select></td><td className="px-3 py-3">{item.disabled ? "Disabled" : "Enabled"}</td><td className="px-3 py-3"><div className="flex flex-wrap items-start gap-2">{item.disabled ? <Button variant="secondary" loading={busy === item.id} onClick={() => void update(item, { action: "enable" }, "Admin enabled.")}>Enable</Button> : <div><Button variant="secondary" disabled={item.id === currentAdminId} loading={busy === item.id} onClick={() => void update(item, { action: "disable" }, "Admin disabled.")}>Disable</Button><p className="mt-1 max-w-xs text-xs text-muted">A disabled admin loses access when their current session expires (up to about an hour).</p></div>}<Button variant="secondary" disabled={busy === item.id} onClick={() => { setResetTarget(item); setResetPassword(""); resetDialog.current?.showModal(); }}>Reset password</Button></div></td></tr>)}
    </tbody></table></div>
    <dialog ref={resetDialog} className="m-auto w-full max-w-md border border-line bg-surface p-6 shadow-dialog backdrop:bg-ink/40"><h2 className="text-question font-bold">Reset password</h2><p className="mt-2">{resetTarget?.name}</p><div className="mt-4"><Field id="reset-password" label="New password" type="password" value={resetPassword} minLength={12} maxLength={128} onChange={(event) => setResetPassword(event.target.value)} /></div><div className="mt-6 flex justify-end gap-3"><Button loading={busy === resetTarget?.id} disabled={resetPassword.length < 12} onClick={() => void reset()}>Reset password</Button><Button variant="secondary" onClick={() => { setResetPassword(""); setResetTarget(undefined); resetDialog.current?.close(); }}>Cancel</Button></div></dialog>
  </section>;
}
