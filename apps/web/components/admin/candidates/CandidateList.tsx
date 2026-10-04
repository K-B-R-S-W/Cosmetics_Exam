"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { CandidateItem, ExamOption } from "@/lib/candidates";

interface CandidateListResponse {
  items: CandidateItem[];
  total: number;
  exam_options?: ExamOption[];
}

interface ErrorResponse {
  error?: { message?: string };
}

const PAGE_SIZE = 50;

export function CandidateList() {
  const [items, setItems] = useState<CandidateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [examOptions, setExamOptions] = useState<ExamOption[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("true");
  const [examId, setExamId] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [unlockingId, setUnlockingId] = useState<string>();
  const examOptionsLoaded = useRef(false);

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(undefined);
    const params = new URLSearchParams({
      active,
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (query) params.set("q", query);
    if (examId) params.set("exam_id", examId);
    if (!examOptionsLoaded.current) params.set("include", "exam_options");

    try {
      const response = await fetch(`/api/admin/candidates?${params}`, {
        cache: "no-store",
        signal,
      });
      const body = (await response.json()) as CandidateListResponse & ErrorResponse;
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Candidates could not be loaded.");
      }

      setItems(body.items);
      setTotal(body.total);
      if (body.exam_options) {
        setExamOptions(body.exam_options);
        examOptionsLoaded.current = true;
      }
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") {
        setError((loadError as Error).message);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [active, examId, page, query]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadCandidates(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loadCandidates]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  async function unlock(candidate: CandidateItem) {
    setUnlockingId(candidate.id);
    setError(undefined);
    setMessage(undefined);

    try {
      const response = await fetch(
        `/api/admin/candidates/${candidate.id}/unlock`,
        { method: "POST" },
      );
      const body = (await response.json()) as { cleared?: number } & ErrorResponse;
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Login could not be unlocked.");
      }

      setMessage(
        body.cleared
          ? `Cleared ${body.cleared} failed login attempt${body.cleared === 1 ? "" : "s"} for ${candidate.mer_code}.`
          : "There were no failed attempts to clear.",
      );
    } catch (unlockError) {
      setError((unlockError as Error).message);
    } finally {
      setUnlockingId(undefined);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="border-t border-hairline pt-6" aria-labelledby="candidates-title">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="mb-2 text-sm text-muted">Administration</p>
          <h1 id="candidates-title" className="text-title font-bold text-ink">
            Candidates
          </h1>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/candidates/import"
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-5 text-md font-bold text-ink hover:bg-selected"
          >
            Import CSV
          </Link>
          <Link
            href="/admin/candidates/new"
            className="inline-flex min-h-11 items-center justify-center rounded-control border border-ink bg-ink px-5 text-md font-bold text-surface hover:opacity-90"
          >
            Add candidate
          </Link>
        </div>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-4" onSubmit={handleSearch}>
        <div className="min-w-80 flex-1">
          <label htmlFor="candidate-search" className="mb-2 block text-sm font-bold text-ink">
            Search
          </label>
          <input
            id="candidate-search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search by MER code, name or outlet"
            className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-md"
          />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
        <label className="text-sm font-bold text-ink">
          <span className="mb-2 block">Status</span>
          <select
            value={active}
            onChange={(event) => { setActive(event.target.value); setPage(1); }}
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-md font-normal"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm font-bold text-ink">
          <span className="mb-2 block">Exam</span>
          <select
            value={examId}
            onChange={(event) => { setExamId(event.target.value); setPage(1); }}
            className="min-h-11 max-w-72 rounded-control border border-line bg-surface px-3 text-md font-normal"
          >
            <option value="">All exams</option>
            {examOptions.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title}</option>
            ))}
          </select>
        </label>
      </form>

      {message ? <p role="status" className="mt-5 border-l-4 border-ok bg-ok-tint px-4 py-3">{message}</p> : null}
      {error ? <p role="alert" className="mt-5 border-l-4 border-alert bg-alert-tint px-4 py-3">{error}</p> : null}

      <div className="mt-6 overflow-x-auto border-y border-hairline bg-surface">
        <table className="w-full min-w-4xl border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline text-sm text-muted">
              <th className="px-3 py-3">MER code</th>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Outlet</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Exams</th>
              <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted">No candidates yet. Add one, or import a CSV.</td></tr>
            ) : null}
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-muted">Loading candidates…</td></tr>
            ) : items.map((candidate) => (
              <tr key={candidate.id} className="border-b border-hairline last:border-b-0">
                <td className="px-3 py-3 font-bold">{candidate.mer_code}</td>
                <td className="px-3 py-3">{candidate.full_name}</td>
                <td className="px-3 py-3">{candidate.outlet || "—"}</td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className={`size-2 rounded-full ${candidate.active ? "bg-ok" : "bg-muted"}`} />
                    {candidate.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-3 py-3" data-tabular-numbers="true">{candidate.assigned_exam_count}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <Link href={`/admin/candidates/${candidate.id}`} className="inline-flex min-h-11 items-center rounded-control border border-line px-4 font-bold text-ink hover:bg-selected">Edit</Link>
                    <Button
                      variant="quiet"
                      loading={unlockingId === candidate.id}
                      onClick={() => void unlock(candidate)}
                    >
                      Unlock login
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <p className="text-sm text-muted">Page {page} of {pageCount}</p>
          <Button variant="secondary" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      ) : null}
    </section>
  );
}
