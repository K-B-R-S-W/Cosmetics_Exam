"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import {
  CANDIDATE_NAME_MAX_LENGTH,
  CANDIDATE_OUTLET_MAX_LENGTH,
  NIC_INPUT_MAX_LENGTH,
  type CandidateItem,
} from "@/lib/candidates";
import { MER_MAX_LENGTH, normalizeMer } from "@/lib/mer";

interface CandidateFormProps {
  candidateId: string | null;
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ path: string; message: string }> | null;
  };
}

export function CandidateForm({ candidateId }: CandidateFormProps) {
  const router = useRouter();
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const editing = candidateId !== null;
  const [candidate, setCandidate] = useState<CandidateItem>();
  const [merCode, setMerCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [outlet, setOutlet] = useState("");
  const [nic, setNic] = useState("");
  const [active, setActive] = useState(true);
  const [showNic, setShowNic] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!candidateId) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/admin/candidates/${candidateId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as { candidate?: CandidateItem } & ErrorBody;
        if (!response.ok || !body.candidate) {
          throw new Error(body.error?.message ?? "Candidate could not be loaded.");
        }
        setCandidate(body.candidate);
        setMerCode(body.candidate.mer_code);
        setFullName(body.candidate.full_name);
        setOutlet(body.candidate.outlet ?? "");
        setActive(body.candidate.active);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") {
          setError((loadError as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [candidateId]);

  function applyError(body: ErrorBody, fallback: string) {
    setError(body.error?.message ?? fallback);
    const next: Record<string, string> = {};
    for (const detail of body.error?.details ?? []) {
      next[detail.path] = detail.message;
    }
    setFieldErrors(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setFieldErrors({});

    const payload = editing
      ? {
          full_name: fullName,
          outlet,
          active,
          ...(nic.trim() ? { nic } : {}),
        }
      : { mer_code: merCode, full_name: fullName, outlet, nic };

    try {
      const response = await fetch(
        editing ? `/api/admin/candidates/${candidateId}` : "/api/admin/candidates",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json()) as ErrorBody;
      if (!response.ok) {
        applyError(body, "Candidate could not be saved.");
        return;
      }

      router.push("/admin/candidates");
      router.refresh();
    } catch {
      setError("Can't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!candidateId) return;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      const body = (await response.json()) as ErrorBody;
      if (!response.ok) {
        applyError(body, "Candidate could not be deactivated.");
        return;
      }
      router.push("/admin/candidates");
      router.refresh();
    } catch {
      setError("Can't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCandidate() {
    if (!candidateId) return;
    setDeleting(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "DELETE",
      });
      const body = (await response.json()) as ErrorBody;
      if (!response.ok) {
        deleteDialog.current?.close();
        applyError(body, "Candidate could not be deleted.");
        return;
      }
      router.push("/admin/candidates");
      router.refresh();
    } catch {
      setError("Can't reach the server. Check the connection and try again.");
      deleteDialog.current?.close();
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="border-t border-hairline pt-6 text-muted">Loading candidate…</p>;
  }

  return (
    <section className="border-t border-hairline pt-6" aria-labelledby="candidate-form-title">
      <p className="mb-2 text-sm text-muted">Candidates</p>
      <h1 id="candidate-form-title" className="text-title font-bold text-ink">
        {editing ? "Edit candidate" : "Add candidate"}
      </h1>

      {error ? <p role="alert" className="mt-5 max-w-2xl border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}

      <form className="mt-6 max-w-2xl space-y-5" onSubmit={submit}>
        <div>
          <Field
            id="mer-code"
            label="MER code"
            value={merCode}
            onChange={(event) => setMerCode(normalizeMer(event.target.value))}
            maxLength={MER_MAX_LENGTH}
            required
            disabled={editing || saving}
            error={fieldErrors.mer_code}
          />
          {editing ? <p className="mt-2 text-sm text-muted">The MER code is the login key and can&apos;t be changed. To use a different code, create a new candidate.</p> : null}
        </div>

        <Field
          id="full-name"
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          maxLength={CANDIDATE_NAME_MAX_LENGTH}
          required
          disabled={saving}
          error={fieldErrors.full_name}
        />

        <Field
          id="outlet"
          label="Outlet"
          value={outlet}
          onChange={(event) => setOutlet(event.target.value)}
          maxLength={CANDIDATE_OUTLET_MAX_LENGTH}
          disabled={saving}
          error={fieldErrors.outlet}
        />

        <div>
          <Field
            id="nic"
            label="ID number"
            type={showNic ? "text" : "password"}
            autoComplete="off"
            value={nic}
            onChange={(event) => setNic(event.target.value)}
            maxLength={NIC_INPUT_MAX_LENGTH}
            required={!editing}
            disabled={saving}
            error={fieldErrors.nic}
            trailingControl={
              <button
                type="button"
                className="min-h-11 px-3 text-sm font-bold hover:underline"
                aria-pressed={showNic}
                onClick={() => setShowNic((shown) => !shown)}
              >
                {showNic ? "Hide" : "Show"}
              </button>
            }
          />
          <p className="mt-2 text-sm text-muted">
            {editing ? "Leave empty to keep the current ID number. " : ""}
            Old format (9 digits then V or X) or new format (12 digits). It is stored hashed and can&apos;t be shown again.
          </p>
        </div>

        {editing ? (
          <label className="flex min-h-11 items-center gap-3 font-bold">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={saving} className="size-5" />
            Active
            <span className="font-normal text-muted">Inactive candidates can&apos;t sign in. Their history is kept.</span>
          </label>
        ) : null}

        {editing && (candidate?.assigned_exam_count ?? 0) > 0 ? (
          <div className="border-l-4 border-warn bg-warn-tint px-4 py-3">
            <p>This candidate has exam history. Deactivate them to block login while keeping that history.</p>
            {active ? <Button className="mt-3" variant="secondary" onClick={() => void deactivate()} loading={saving}>Deactivate candidate</Button> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button type="submit" loading={saving}>Save</Button>
          <Link href="/admin/candidates" className="inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-5 font-bold text-ink hover:bg-selected">Cancel</Link>
          {editing ? <Button className="ml-auto" variant="destructive" onClick={() => deleteDialog.current?.showModal()}>Delete candidate</Button> : null}
        </div>
      </form>

      <dialog ref={deleteDialog} className="m-auto w-full max-w-md border border-line bg-surface p-0 text-ink shadow-dialog backdrop:bg-ink/40">
        <div className="p-6">
          <h2 className="text-question font-bold">Delete this candidate?</h2>
          <p className="mt-3">This removes {candidate?.full_name ?? "this candidate"} and cannot be undone.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="destructive" loading={deleting} onClick={() => void removeCandidate()}>Delete candidate</Button>
            <Button variant="secondary" autoFocus onClick={() => deleteDialog.current?.close()}>Keep candidate</Button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
