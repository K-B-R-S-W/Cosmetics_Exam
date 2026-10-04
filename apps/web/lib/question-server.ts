import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import {
  QUESTION_REQUEST_MAX_BYTES,
  type AnswerKeyInput,
  type CompleteQuestionDocument,
  type QuestionImage,
} from "@/lib/questions";

export const QUESTION_BUCKET = "question-images";
export const QUESTION_COLUMNS = "id, exam_id, position, type, body_html, image_path, image_alt_text, image_mime, image_size_bytes, marks, mcq_options(id, position, label, text_html), answer_keys(question_id, correct_option_id, model_answer, grading_notes, calibration)";

interface QuestionRow {
  id: string;
  exam_id: string;
  position: number;
  type: "mcq" | "written";
  body_html: string;
  image_path: string | null;
  image_alt_text: string | null;
  image_mime: "image/jpeg" | "image/png" | "image/webp" | null;
  image_size_bytes: number | null;
  marks: number | string;
  mcq_options?: Array<{ id: string; position: number; label: string; text_html: string }> | null;
  answer_keys?: Array<AnswerKeyInput & { question_id?: string }> | (AnswerKeyInput & { question_id?: string }) | null;
}

export interface AdminQuestionItem extends CompleteQuestionDocument {
  position: number;
  image: (QuestionImage & { preview_url?: string }) | null;
  options: Array<{ id: string; position: number; label: string; text_html: string }>;
}

export function assertQuestionRequestSize(request: Request): void {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0 || length > QUESTION_REQUEST_MAX_BYTES) {
    throw new ApiError("payload_too_large", 413, "The request is too large.");
  }
}

export async function readQuestionJson(request: Request): Promise<unknown> {
  assertQuestionRequestSize(request);
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > QUESTION_REQUEST_MAX_BYTES) {
    throw new ApiError("payload_too_large", 413, "The request is too large.");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("validation_failed", 400, "Send a valid JSON body.");
  }
}

export function questionNotFound(): ApiError {
  return new ApiError("not_found", 404, "Question not found.");
}

export function throwQuestionRpcError(error: unknown): never {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
  const code = message.trim();
  if (code === "exam_locked") throw new ApiError("exam_locked", 409, "This exam has started, so its questions cannot change.");
  if (code === "grading_in_progress") throw new ApiError("grading_in_progress", 409, "Grading is in progress. Try again after it finishes.");
  if (code === "exam_not_found" || code === "not_found") throw questionNotFound();
  if (code === "type_immutable") throw new ApiError("type_immutable", 400, "Delete and recreate the question to change its type.");
  if (code === "validation_failed" || code === "bad_correct_option" || code === "type_mismatch") {
    throw new ApiError("validation_failed", 400, "Check the highlighted fields and try again.");
  }
  throw error;
}

function answerKeyFrom(row: QuestionRow): AnswerKeyInput {
  const relation = Array.isArray(row.answer_keys) ? row.answer_keys[0] : row.answer_keys;
  return {
    correct_option_id: relation?.correct_option_id ?? null,
    model_answer: relation?.model_answer ?? null,
    grading_notes: relation?.grading_notes ?? null,
    calibration: relation?.calibration ?? [],
  };
}

export function toQuestionItem(row: QuestionRow): AdminQuestionItem {
  const image = row.image_path && row.image_alt_text && row.image_mime && row.image_size_bytes
    ? { path: row.image_path, alt_text: row.image_alt_text, mime: row.image_mime, size_bytes: row.image_size_bytes }
    : null;
  const options = [...(row.mcq_options ?? [])].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    exam_id: row.exam_id,
    position: row.position,
    type: row.type,
    body_html: row.body_html,
    marks: Number(row.marks),
    image,
    options,
    answer_key: answerKeyFrom(row),
  };
}

export async function loadQuestion(client: SupabaseClient, id: string): Promise<AdminQuestionItem> {
  const { data, error } = await client.from("questions").select(QUESTION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw questionNotFound();
  return toQuestionItem(data as unknown as QuestionRow);
}

export async function verifyQuestionImage(
  client: SupabaseClient,
  image: QuestionImage | null,
  questionId?: string,
): Promise<void> {
  if (!image) return;
  const bucket = client.storage.from(QUESTION_BUCKET);
  const { data: info, error } = await bucket.info(image.path);
  if (error || !info) throw new ApiError("invalid_image", 400, "Upload the image again.");
  const contentType = (info as { contentType?: string }).contentType;
  if (info.size !== image.size_bytes || contentType !== image.mime) {
    throw new ApiError("invalid_image", 400, "The uploaded image metadata does not match.");
  }
  let query = client.from("questions").select("id").eq("image_path", image.path).limit(1);
  if (questionId) query = query.neq("id", questionId);
  const { data: references, error: referenceError } = await query;
  if (referenceError) throw referenceError;
  if ((references?.length ?? 0) > 0) throw new ApiError("invalid_image", 400, "That image is already attached to another question.");
}

export async function addPreviewUrl(client: SupabaseClient, item: AdminQuestionItem): Promise<AdminQuestionItem> {
  if (!item.image) return item;
  const { data, error } = await client.storage.from(QUESTION_BUCKET).createSignedUrl(item.image.path, 300);
  if (error || !data?.signedUrl) throw error ?? new Error("signed_url_failed");
  return { ...item, image: { ...item.image, preview_url: data.signedUrl } };
}

export async function removeQuestionImageWithRetry(client: SupabaseClient, path: string, actorId: string): Promise<boolean> {
  const bucket = client.storage.from(QUESTION_BUCKET);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await bucket.remove([path]);
    if (!error) return true;
  }
  logger.warn("question_image_cleanup_deferred", { actorId, errorCode: "storage_delete_failed" });
  return false;
}

export function saveQuestionArgs(document: CompleteQuestionDocument): Record<string, unknown> {
  return {
    p_question_id: document.id,
    p_exam_id: document.exam_id,
    p_type: document.type,
    p_body_html: document.body_html,
    p_marks: document.marks,
    p_position: document.position,
    p_image_path: document.image?.path ?? null,
    p_image_alt_text: document.image?.alt_text ?? null,
    p_image_mime: document.image?.mime ?? null,
    p_image_size_bytes: document.image?.size_bytes ?? null,
    p_options: document.options.map((option) => ({ id: option.id, text_html: option.text_html })),
    p_correct_option_id: document.answer_key.correct_option_id,
    p_model_answer: document.answer_key.model_answer,
    p_grading_notes: document.answer_key.grading_notes,
    p_calibration: document.answer_key.calibration,
  };
}
