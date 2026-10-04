import { z } from "zod";

import { MER_MAX_LENGTH, normalizeMer } from "@/lib/mer";

export const CANDIDATE_NAME_MAX_LENGTH = 200;
export const CANDIDATE_OUTLET_MAX_LENGTH = 200;
export const NIC_INPUT_MAX_LENGTH = 20;
export const CANDIDATE_IMPORT_BATCH_LIMIT = 100;
export const CANDIDATE_CLIENT_BATCH_SIZE = 50;

const merSchema = z
  .string()
  .trim()
  .min(1, "Enter a MER code.")
  .max(MER_MAX_LENGTH, `MER code must be ${MER_MAX_LENGTH} characters or fewer.`)
  .transform(normalizeMer);

const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the candidate's full name.")
  .max(
    CANDIDATE_NAME_MAX_LENGTH,
    `Full name must be ${CANDIDATE_NAME_MAX_LENGTH} characters or fewer.`,
  );

const outletSchema = z
  .string()
  .trim()
  .max(
    CANDIDATE_OUTLET_MAX_LENGTH,
    `Outlet must be ${CANDIDATE_OUTLET_MAX_LENGTH} characters or fewer.`,
  )
  .transform((value) => value || null)
  .nullable()
  .optional();

const nicSchema = z
  .string()
  .max(
    NIC_INPUT_MAX_LENGTH,
    `ID number must be ${NIC_INPUT_MAX_LENGTH} characters or fewer.`,
  );

export const createCandidateSchema = z.object({
  mer_code: merSchema,
  full_name: fullNameSchema,
  outlet: outletSchema,
  nic: nicSchema.trim().min(1, "Enter the ID number."),
});

export const updateCandidateSchema = z
  .object({
    full_name: fullNameSchema.optional(),
    outlet: outletSchema,
    nic: nicSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update.",
  });

export const candidateListQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  exam_id: z.uuid().optional(),
  active: z.enum(["true", "false", "all"]).optional().default("true"),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(200).optional().default(50),
  include: z.enum(["exam_options"]).optional(),
});

export const importCandidateRowSchema = z.object({
  mer_code: merSchema,
  full_name: fullNameSchema,
  outlet: outletSchema,
  nic: nicSchema.trim().min(1, "Enter the ID number."),
});

export const importCandidatesSchema = z.object({
  rows: z
    .array(z.unknown())
    .min(1, "Include at least one row.")
    .max(
      CANDIDATE_IMPORT_BATCH_LIMIT,
      `Send at most ${CANDIDATE_IMPORT_BATCH_LIMIT} rows per request.`,
    ),
  on_duplicate: z.enum(["skip", "update"]).optional().default("skip"),
  dry_run: z.boolean().optional().default(false),
});

export interface CandidateItem {
  id: string;
  mer_code: string;
  full_name: string;
  outlet: string | null;
  active: boolean;
  created_at: string;
  assigned_exam_count: number;
}

export interface ExamOption {
  id: string;
  title: string;
  status: string;
}

export interface CandidateImportRow {
  mer_code: string;
  full_name: string;
  outlet?: string | null;
  nic: string;
}

export interface CandidateImportError {
  row: number;
  mer_code: string;
  code: "duplicate_mer_in_batch" | "invalid_nic" | "validation_failed";
  message: string;
}
