import { z } from "zod";

import { ApiError, apiErrorResponse, jsonResponse, readJson } from "@/lib/api";
import { recordAdminAction } from "@/lib/admin-server";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/origin";
import {
  SnapshotPurgeConfigurationError,
  runSnapshotPurge,
} from "@/lib/snapshot-purge";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 30;
const ROUTE = "/api/admin/snapshots/purge";

const purgeSchema = z.strictObject({
  exam_id: z.uuid().optional(),
  dry_run: z.boolean(),
  confirm: z.literal(true).optional(),
}).superRefine((value, context) => {
  if (!value.dry_run && value.confirm !== true) {
    context.addIssue({
      code: "custom",
      path: ["confirm"],
      message: "Confirm snapshot deletion.",
    });
  }
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const admin = await requireSuperAdmin();
    const input = purgeSchema.parse(await readJson(request));
    const client = createServiceRoleClient();
    const result = await runSnapshotPurge({
      client,
      dryRun: input.dry_run,
      examId: input.exam_id,
      retentionDays: process.env.SNAPSHOT_RETENTION_DAYS,
      onInvalidPaths: (count) => logger.warn("snapshot_purge_invalid_paths", { itemCount: count }),
    });

    if (!input.dry_run) {
      await recordAdminAction(client, admin, "snapshot_purge", input.exam_id ?? null, {
        eligible: result.eligible,
        deleted: result.deleted,
        failed: result.failed,
        remaining: result.remaining,
      });
    }

    return jsonResponse({
      eligible: result.eligible,
      deleted: result.deleted,
      failed: result.failed,
      remaining: result.remaining,
      dry_run: result.dry_run,
    });
  } catch (error) {
    if (error instanceof SnapshotPurgeConfigurationError) {
      return new ApiError(
        "service_unavailable",
        503,
        "Snapshot cleanup is unavailable.",
      ).toResponse();
    }
    return apiErrorResponse(error, ROUTE);
  }
}
