import { apiErrorResponse, ApiError, jsonResponse } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/origin";
import { processQuestionImage } from "@/lib/question-images";
import {
  QUESTION_BUCKET,
  loadQuestion,
  readQuestionJson,
  removeQuestionImageWithRetry,
  saveQuestionArgs,
  throwQuestionRpcError,
} from "@/lib/question-server";
import { QUESTION_IMAGE_MAX_BYTES, QUESTION_IMAGE_MULTIPART_OVERHEAD, questionIdSchema, questionImageSchema } from "@/lib/questions";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ROUTE = "/api/admin/question-images";

function assertUploadContentLength(request: Request): void {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0 || length > QUESTION_IMAGE_MAX_BYTES + QUESTION_IMAGE_MULTIPART_OVERHEAD) {
    throw new ApiError("payload_too_large", 413, "The upload must be 4 MiB or smaller.");
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return value !== null && typeof value !== "string" && typeof value.arrayBuffer === "function";
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    assertUploadContentLength(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError("validation_failed", 400, "Send one image and alt text.");
    }
    const file = form.get("file");
    const altText = form.get("alt_text");
    if (!isUploadedFile(file) || typeof altText !== "string") {
      throw new ApiError("validation_failed", 400, "Send one image and alt text.");
    }
    if (file.size > QUESTION_IMAGE_MAX_BYTES) throw new ApiError("payload_too_large", 413, "The image must be 4 MiB or smaller.");
    const parsedAlt = questionImageSchema.shape.alt_text.safeParse(altText);
    if (!parsedAlt.success) throw parsedAlt.error;
    const processed = await processQuestionImage(Buffer.from(await file.arrayBuffer()), file.type);
    const path = `questions/${admin.id}/${crypto.randomUUID()}.${processed.extension}`;
    const client = createServiceRoleClient();
    const { error } = await client.storage.from(QUESTION_BUCKET).upload(path, processed.buffer, {
      cacheControl: "31536000",
      contentType: processed.mime,
      upsert: false,
    });
    if (error) throw error;
    const image = {
      path,
      alt_text: parsedAlt.data,
      mime: processed.mime,
      size_bytes: processed.buffer.length,
    };
    return jsonResponse({ image }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const body = await readQuestionJson(request);
    const parsed = questionImageSchema.shape.path.safeParse(
      typeof body === "object" && body !== null && "path" in body ? (body as { path: unknown }).path : null,
    );
    if (!parsed.success) throw parsed.error;
    const path = parsed.data;
    const client = createServiceRoleClient();
    const { data: references, error: referenceError } = await client.from("questions").select("id").eq("image_path", path).limit(2);
    if (referenceError) throw referenceError;
    if ((references?.length ?? 0) > 0) {
      const questionId = questionIdSchema.safeParse(
        typeof body === "object" && body !== null && "question_id" in body ? (body as { question_id: unknown }).question_id : null,
      );
      if (!questionId.success || references!.length !== 1 || references![0]!.id !== questionId.data) {
        throw new ApiError("forbidden", 403, "You cannot remove that image.");
      }
      const question = await loadQuestion(client, questionId.data);
      if (question.image?.path !== path) throw new ApiError("not_found", 404, "Image not found.");
      const { error } = await client.rpc("save_question", saveQuestionArgs({ ...question, image: null }));
      if (error) throwQuestionRpcError(error);
      await recordAdminAction(client, admin, "question_save", question.id, {
        exam_id: question.exam_id,
        question_id: question.id,
        option_count: question.options.length,
      });
    } else if (!path.startsWith(`questions/${admin.id}/`)) {
      throw new ApiError("forbidden", 403, "You cannot remove that upload.");
    }
    const removed = await removeQuestionImageWithRetry(client, path, admin.id);
    if (!removed) throw new ApiError("service_unavailable", 503, "The image could not be removed. Try again.");
    return jsonResponse({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
