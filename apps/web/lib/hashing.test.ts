import { parseOptions } from "@node-rs/argon2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InvalidNicError,
  NIC_HASH_POLICY,
  NicPepperConfigurationError,
  hashNic,
  normalizeNic,
  verifyNic,
} from "./hashing";

const originalPepper = process.env.NIC_PEPPER;
const TEST_PEPPER = "synthetic-test-pepper-not-for-production";

describe("normalizeNic", () => {
  it("trims and preserves a canonical 12-digit NIC", () => {
    expect(normalizeNic("  190000000000  ")).toBe("190000000000");
  });

  it.each([
    ["000000000V", "190000000000"],
    [" 000000000v ", "190000000000"],
    ["999990000X", "199999900000"],
    ["\t999990000x\r\n", "199999900000"],
  ])("converts synthetic old-format fixture %s", (input, expected) => {
    expect(normalizeNic(input)).toBe(expected);
  });

  it.each([
    "",
    "12345678V",
    "1234567890V",
    "123456789",
    "123456789Q",
    "12345678901",
    "1234567890123",
    "12345 6789V",
    "123456\t789V",
    "１２３４５６７８９０１２",
  ])("rejects invalid format without echoing input: %s", (input) => {
    expect(() => normalizeNic(input)).toThrow(InvalidNicError);

    try {
      normalizeNic(input);
      expect.unreachable("Expected NIC normalization to fail");
    } catch (error) {
      if (input.length > 0) {
        expect((error as Error).message).not.toContain(input);
      }
    }
  });
});

describe("NIC hashing", () => {
  beforeEach(() => {
    process.env.NIC_PEPPER = TEST_PEPPER;
  });

  afterEach(() => {
    if (originalPepper === undefined) {
      delete process.env.NIC_PEPPER;
    } else {
      process.env.NIC_PEPPER = originalPepper;
    }
  });

  it("uses the declared Argon2id policy and a random salt", async () => {
    const first = await hashNic("000000000V");
    const second = await hashNic("000000000V");

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("000000000V");
    expect(first).not.toContain("190000000000");
    expect(first).not.toContain(TEST_PEPPER);
    expect(parseOptions(first)).toMatchObject(NIC_HASH_POLICY);
  });

  it("verifies equivalent old and canonical new formats", async () => {
    const encodedHash = await hashNic("000000000v");

    await expect(verifyNic("190000000000", encodedHash)).resolves.toBe(true);
    await expect(verifyNic("999999999999", encodedHash)).resolves.toBe(false);
  });

  it("returns false for malformed input after doing a verification", async () => {
    const encodedHash = await hashNic("190000000000");

    await expect(verifyNic("12345 6789V", encodedHash)).resolves.toBe(false);
  });

  it("fails verification when the pepper changes", async () => {
    const encodedHash = await hashNic("190000000000");
    process.env.NIC_PEPPER = "different-synthetic-test-pepper";

    await expect(verifyNic("190000000000", encodedHash)).resolves.toBe(false);
  });

  it.each([undefined, "", "   "])(
    "fails closed when NIC_PEPPER is missing or blank",
    async (pepper) => {
      if (pepper === undefined) {
        delete process.env.NIC_PEPPER;
      } else {
        process.env.NIC_PEPPER = pepper;
      }

      await expect(hashNic("190000000000")).rejects.toBeInstanceOf(
        NicPepperConfigurationError,
      );
      await expect(
        verifyNic("190000000000", "$argon2id$invalid"),
      ).rejects.toBeInstanceOf(NicPepperConfigurationError);
    },
  );
});
