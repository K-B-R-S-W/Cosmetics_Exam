import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { databaseUnavailable, recordAdminAction } from "@/lib/admin-server";
import { requireAdmin } from "@/lib/auth";
import { examIdSchema } from "@/lib/exams";
import { logger } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/origin";
import { QUESTION_BUCKET } from "@/lib/question-server";
import { createServiceRoleClient } from "@/lib/supabase/server";

const ROUTE = "/api/admin/exams/[id]/duplicate";

interface RouteContext { params: Promise<{ id: string }> }

const imageMappingSchema = z.object({
  source_question_id: z.uuid(),
  question_id: z.uuid(),
  source_path: z.string().min(1),
  destination_path: z.string().min(1),
  alt_text: z.string().min(1).max(500),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size_bytes: z.number().int().positive(),
}).strict();

const duplicateResultSchema = z.object({
  exam_id: z.uuid(),
  images: z.array(imageMappingSchema),
}).strict();

type ImageFailure = {
  question_id: string;
  reason: "copy_failed" | "metadata_update_failed";
  orphan_leftover: boolean;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const sourceId = examIdSchema.safeParse((await context.params).id);
    if (!sourceId.success) throw new ApiError("not_found", 404, "Exam not found.");
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc("duplicate_exam", {
      p_exam_id: sourceId.data,
      p_created_by: admin.id,
    });
    if (error) {
      if (String(error.message ?? "").trim() === "exam_not_found") {
        throw new ApiError("not_found", 404, "Exam not found.");
      }
      throw databaseUnavailable();
    }
    const duplicate = duplicateResultSchema.safeParse(data);
    if (!duplicate.success) throw databaseUnavailable();

    const failures: ImageFailure[] = [];
    const bucket = client.storage.from(QUESTION_BUCKET);
    for (const image of duplicate.data.images) {
      const copied = await bucket.copy(image.source_path, image.destination_path);
      if (copied.error) {
        failures.push({ question_id: image.question_id, reason: "copy_failed", orphan_leftover: false });
        continue;
      }

      const updated = await client
        .from("questions")
        .update({
          image_path: image.destination_path,
          image_alt_text: image.alt_text,
          image_mime: image.mime,
          image_size_bytes: image.size_bytes,
        })
        .eq("id", image.question_id)
        .eq("exam_id", duplicate.data.exam_id)
        .is("image_path", null)
        .select("id")
        .maybeSingle();
      if (updated.error || !updated.data) {
        let orphanLeftover = true;
        try {
          const removed = await bucket.remove([image.destination_path]);
          orphanLeftover = Boolean(removed.error);
        } catch {
          orphanLeftover = true;
        }
        failures.push({ question_id: image.question_id, reason: "metadata_update_failed", orphan_leftover: orphanLeftover });
        if (orphanLeftover) {
          logger.warn("duplicate_exam_image_orphan", {
            actorId: admin.id,
            errorCode: "storage_delete_failed",
            failureCount: 1,
          });
        }
      }
    }

    await recordAdminAction(client, admin, "exam_duplicate", duplicate.data.exam_id, {
      source_exam_id: sourceId.data,
      image_count: duplicate.data.images.length,
      image_failures: failures.length,
    });
    return jsonResponse({ exam_id: duplicate.data.exam_id, image_failures: failures }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
