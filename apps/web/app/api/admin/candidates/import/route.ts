import { ApiError, apiErrorResponse, jsonResponse } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import {
  databaseUnavailable,
  recordAdminAction,
} from "@/lib/candidate-server";
import {
  importCandidateRowSchema,
  importCandidatesSchema,
  type CandidateImportError,
} from "@/lib/candidates";
import { hashNic, InvalidNicError, normalizeNic } from "@/lib/hashing";
import { normalizeMer } from "@/lib/mer";
import { assertSameOrigin } from "@/lib/origin";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const ROUTE = "/api/admin/candidates/import";
const IMPORT_BODY_LIMIT = 500 * 1024;

interface ValidRow {
  row: number;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  nic: string;
}

function rawMer(value: unknown): string {
  if (!value || typeof value !== "object" || !("mer_code" in value)) {
    return "";
  }

  const mer = (value as { mer_code?: unknown }).mer_code;
  return typeof mer === "string" ? normalizeMer(mer) : "";
}

function prepareRows(rows: unknown[]): {
  validRows: ValidRow[];
  errors: CandidateImportError[];
} {
  const validRows: ValidRow[] = [];
  const errors: CandidateImportError[] = [];
  const seenMers = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const mer = rawMer(row);

    if (mer && seenMers.has(mer)) {
      errors.push({
        row: rowNumber,
        mer_code: mer,
        code: "duplicate_mer_in_batch",
        message: "This MER code is repeated in this batch.",
      });
      return;
    }

    if (mer) seenMers.add(mer);

    const parsed = importCandidateRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        row: rowNumber,
        mer_code: mer,
        code: "validation_failed",
        message: parsed.error.issues[0]?.message ?? "Check this row.",
      });
      return;
    }

    try {
      normalizeNic(parsed.data.nic);
    } catch (error) {
      if (error instanceof InvalidNicError) {
        errors.push({
          row: rowNumber,
          mer_code: parsed.data.mer_code,
          code: "invalid_nic",
          message: "This ID number isn't valid.",
        });
        return;
      }
      throw error;
    }

    validRows.push({
      row: rowNumber,
      mer_code: parsed.data.mer_code,
      full_name: parsed.data.full_name,
      outlet: parsed.data.outlet ?? null,
      nic: parsed.data.nic,
    });
  });

  return { validRows, errors };
}

async function readImportJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > IMPORT_BODY_LIMIT) {
    throw new ApiError(
      "payload_too_large",
      413,
      "Send no more than 100 candidates in one batch.",
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("validation_failed", 400, "Send a valid JSON body.");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > IMPORT_BODY_LIMIT) {
      throw new ApiError(
        "payload_too_large",
        413,
        "Send no more than 100 candidates in one batch.",
      );
    }

    const admin = await requireAdmin();
    const body = importCandidatesSchema.parse(await readImportJson(request));
    const { validRows, errors } = prepareRows(body.rows);
    const client = createServiceRoleClient();
    const mers = validRows.map((row) => row.mer_code);
    const existingMers = new Set<string>();

    if (mers.length > 0) {
      const { data, error } = await client
        .from("candidates")
        .select("mer_code")
        .in("mer_code", mers);

      if (error) throw databaseUnavailable();
      for (const candidate of data ?? []) {
        existingMers.add(candidate.mer_code);
      }
    }

    const created = validRows.filter(
      (row) => !existingMers.has(row.mer_code),
    ).length;
    const existing = validRows.length - created;
    const updated = body.on_duplicate === "update" ? existing : 0;
    const skipped = body.on_duplicate === "skip" ? existing : 0;

    if (body.dry_run) {
      return jsonResponse({
        dry_run: true,
        created,
        updated,
        skipped,
        errors,
      });
    }

    const rowsToApply =
      body.on_duplicate === "skip"
        ? validRows.filter((row) => !existingMers.has(row.mer_code))
        : validRows;
    const upsertRows: Array<{
      mer_code: string;
      full_name: string;
      outlet: string | null;
      nic_hash: string;
    }> = [];

    // Keep hashing sequential: the bulk write stays one statement while the
    // route holds only one 19 MiB Argon2 allocation at a time.
    for (const row of rowsToApply) {
      upsertRows.push({
        mer_code: row.mer_code,
        full_name: row.full_name,
        outlet: row.outlet,
        nic_hash: await hashNic(row.nic),
      });
    }

    if (upsertRows.length > 0) {
      const { error } = await client.from("candidates").upsert(upsertRows, {
        onConflict: "mer_code",
        ignoreDuplicates: body.on_duplicate === "skip",
      });

      if (error) {
        throw new ApiError(
          "batch_not_applied",
          503,
          "This whole batch was not applied. Fix the problem and try again.",
          { attempted: upsertRows.length },
        );
      }

      await recordAdminAction(client, admin, "candidate_import", null, {
        created,
        updated,
        skipped,
        errors: errors.length,
        on_duplicate: body.on_duplicate,
      });
    }

    return jsonResponse({
      dry_run: false,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (error) {
    return apiErrorResponse(error, ROUTE);
  }
}
