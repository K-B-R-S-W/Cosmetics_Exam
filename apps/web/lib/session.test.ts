import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_SESSION_COOKIE,
  sessionOptionsForExam,
} from "./session";

const originalSecret = process.env.SESSION_SECRET;

describe("sessionOptionsForExam", () => {
  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("uses exam duration plus two hours", () => {
    process.env.SESSION_SECRET = "a-secure-test-secret-that-is-over-32-characters";

    const options = sessionOptionsForExam(90);

    expect(options.cookieName).toBe(CANDIDATE_SESSION_COOKIE);
    expect(options.ttl).toBe(90 * 60 + 2 * 60 * 60);
    expect(options.cookieOptions?.httpOnly).toBe(true);
    expect(options.cookieOptions?.sameSite).toBe("lax");
    expect(options.cookieOptions?.path).toBe("/");
  });

  it("rejects an invalid duration", () => {
    process.env.SESSION_SECRET = "a-secure-test-secret-that-is-over-32-characters";

    expect(() => sessionOptionsForExam(0)).toThrow(
      "Exam duration must be a positive whole number of minutes",
    );
  });
});
