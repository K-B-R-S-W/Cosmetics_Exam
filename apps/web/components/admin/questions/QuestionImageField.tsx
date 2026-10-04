"use client";

import { useEffect, useRef, useState } from "react";

import type { EditorQuestion, ApiErrorBody } from "@/components/admin/questions/question-types";
import { Button } from "@/components/ui/Button";
import { QUESTION_IMAGE_MAX_BYTES } from "@/lib/questions";

type EditorImage = EditorQuestion["image"];

interface QuestionImageFieldProps {
  disabled?: boolean;
  image: EditorImage;
  onBusyChange?: (busy: boolean) => void;
  onChange: (image: EditorImage) => void;
  persistedPath: string | null;
  questionId: string;
}

export function QuestionImageField({ disabled = false, image, onBusyChange, onChange, persistedPath, questionId }: QuestionImageFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(Boolean(image));
  const [altText, setAltText] = useState(image?.alt_text ?? "");
  const [file, setFile] = useState<File>();
  const [localUrl, setLocalUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  function setWorking(next: boolean) { setBusy(next); onBusyChange?.(next); }
  async function deleteOrphan(path: string) {
    if (path === persistedPath) return;
    await fetch("/api/admin/question-images", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, question_id: questionId }),
    });
  }
  function choose(next: File | undefined) {
    if (localUrl) URL.revokeObjectURL(localUrl);
    setFile(next);
    setLocalUrl(next ? URL.createObjectURL(next) : undefined);
    setError(undefined);
  }
  async function upload() {
    if (!file) { setError("Choose a JPEG, PNG or WebP image."); return; }
    if (!altText.trim()) { setError("Enter alt text before uploading."); return; }
    if (file.size > QUESTION_IMAGE_MAX_BYTES) { setError("The image must be 4 MiB or smaller."); return; }
    setWorking(true); setError(undefined);
    try {
      const form = new FormData(); form.append("file", file); form.append("alt_text", altText.trim());
      const response = await fetch("/api/admin/question-images", { method: "POST", body: form });
      const body = await response.json() as { image?: NonNullable<EditorImage> } & ApiErrorBody;
      if (!response.ok || !body.image) throw new Error(body.error?.message ?? "The image could not be uploaded.");
      if (image?.path && image.path !== persistedPath && image.path !== body.image.path) await deleteOrphan(image.path);
      onChange(body.image); setFile(undefined);
    } catch (uploadError) { setError((uploadError as Error).message); }
    finally { setWorking(false); }
  }
  async function remove() {
    setWorking(true); setError(undefined);
    try {
      if (image?.path) await deleteOrphan(image.path);
      onChange(null); choose(undefined); setEnabled(false); setAltText("");
    } catch { setError("The image could not be removed. Try again."); }
    finally { setWorking(false); }
  }

  return <fieldset disabled={disabled || busy} className="space-y-3">
    <legend className="sr-only">Question image</legend>
    <label className="flex min-h-11 items-center gap-3 font-bold"><input type="checkbox" checked={enabled} onChange={(event) => {
      setEnabled(event.target.checked);
      if (!event.target.checked) void remove();
    }} /> Add image</label>
    {enabled ? <div className="space-y-3 border border-hairline p-4">
      {image?.image_missing ? <p className="border-l-4 border-alert bg-alert-tint px-4 py-3" role="alert">The saved image is missing. Re-upload the image before candidates need it.</p> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- signed and blob preview URLs are already processed and short-lived */}
      {(localUrl || image?.preview_url) ? <img className="max-h-80 w-auto border border-hairline object-contain" src={localUrl ?? image?.preview_url} alt={altText || image?.alt_text || "Question image preview"} /> : null}
      <label className="block font-bold">Alt text<input className="mt-2 min-h-11 w-full border border-line px-3 font-normal" maxLength={500} required value={altText} onChange={(event) => { setAltText(event.target.value); if (image) onChange({ ...image, alt_text: event.target.value }); }} /></label>
      <p className="text-sm text-muted">Describe only what the candidate needs from the image. Do not include the answer or a hint.</p>
      <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label={image ? "Replace image file" : "Question image file"} onChange={(event) => choose(event.target.files?.[0])} />
      <Button variant="secondary" onClick={() => input.current?.click()}>{image ? "Replace image" : "Choose image"}</Button>
      {file ? <Button variant="secondary" loading={busy} onClick={() => void upload()}>{image ? "Upload replacement" : "Upload image"}</Button> : null}
      {image ? <Button variant="quiet" onClick={() => void remove()}>Remove image</Button> : null}
      {error ? <p role="alert" className="text-sm text-alert">{error}</p> : null}
    </div> : null}
  </fieldset>;
}
