import "server-only";

import { hash, verify } from "@node-rs/argon2";
import type { Algorithm, Version } from "@node-rs/argon2";

// @node-rs/argon2 declares these as ambient const enums, which cannot be
// referenced directly while this project uses TypeScript isolatedModules.
const ARGON2ID = 2 as Algorithm;
const ARGON2_VERSION_13 = 1 as Version;

export const NIC_HASH_POLICY = Object.freeze({
  algorithm: ARGON2ID,
  version: ARGON2_VERSION_13,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const OLD_NIC_PATTERN = /^\d{9}[VX]$/;
const NEW_NIC_PATTERN = /^\d{12}$/;
const INVALID_NIC_SENTINEL = "000000000000";

export class InvalidNicError extends Error {
  constructor() {
    super("NIC must be 9 digits followed by V or X, or 12 digits.");
    this.name = "InvalidNicError";
  }
}

export class NicPepperConfigurationError extends Error {
  constructor() {
    super("NIC_PEPPER is required.");
    this.name = "NicPepperConfigurationError";
  }
}

/**
 * Converts both accepted Sri Lankan NIC representations to the canonical
 * 12-digit representation used as the Argon2 input.
 */
export function normalizeNic(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (NEW_NIC_PATTERN.test(normalized)) {
    return normalized;
  }

  if (!OLD_NIC_PATTERN.test(normalized)) {
    throw new InvalidNicError();
  }

  const digits = normalized.slice(0, 9);
  return `19${digits.slice(0, 5)}0${digits.slice(5)}`;
}

function getNicPepper(): Uint8Array {
  const pepper = process.env.NIC_PEPPER;

  if (!pepper || pepper.trim().length === 0) {
    throw new NicPepperConfigurationError();
  }

  return new TextEncoder().encode(pepper);
}

export async function hashNic(value: string): Promise<string> {
  const secret = getNicPepper();
  const canonicalNic = normalizeNic(value);

  return hash(canonicalNic, {
    ...NIC_HASH_POLICY,
    secret,
  });
}

export async function verifyNic(
  value: string,
  encodedHash: string,
): Promise<boolean> {
  const secret = getNicPepper();
  let canonicalNic: string;
  let validFormat = true;

  try {
    canonicalNic = normalizeNic(value);
  } catch (error) {
    if (!(error instanceof InvalidNicError)) {
      throw error;
    }

    // Still pay the Argon2 verification cost for malformed input. Candidate
    // authentication must not introduce a fast failure path around Argon2.
    canonicalNic = INVALID_NIC_SENTINEL;
    validFormat = false;
  }

  const matches = await verify(encodedHash, canonicalNic, { secret });
  return validFormat && matches;
}
