"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

export function OverrideForm({ attemptId, questionId, maxMarks, onSaved }: { attemptId: string; questionId: string; maxMarks: number; onSaved?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [marks, setMarks] = useState(0); const [note, setNote] = useState("");
  async function save() {
    try {
      const response = await fetch(`/api/admin/results/${attemptId}/override`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: questionId, marks, note }) });
      if (!response.ok) { toast.error("Could not save override."); return; }
      toast.success("Override saved."); onSaved?.(); router.refresh();
    } catch { toast.error("Could not save override."); }
  }
  return <div className="grid gap-2 sm:grid-cols-[7rem_1fr_auto]"><label>Marks<input className="block min-h-11 w-full border border-line px-2" type="number" min={0} max={maxMarks} step="0.25" value={marks} onChange={(event) => setMarks(Number(event.target.value))} /></label><label>Reason<input className="block min-h-11 w-full border border-line px-2" value={note} onChange={(event) => setNote(event.target.value)} /></label><Button disabled={!note.trim()} onClick={() => void save()}>Save override</Button></div>;
}
