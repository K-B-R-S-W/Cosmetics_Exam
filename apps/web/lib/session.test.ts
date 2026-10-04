import { getIronSession } from "iron-session";
import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_SESSION_COOKIE,
  candidateSessionReadOptions,
  type CandidateSessionData,
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

  it("reads a cookie sealed for a 45-minute exam with fixed read options", async () => {
    process.env.SESSION_SECRET = "a-secure-test-secret-that-is-over-32-characters";
    const values = new Map<string, string>();
    const store = {
      get: (name: string) => {
        const value = values.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => values.set(name, value),
    };
    const written = await getIronSession<CandidateSessionData>(
      store,
      sessionOptionsForExam(45),
    );
    written.sid = "00000000-0000-4000-8000-000000000001";
    await written.save();

    const read = await getIronSession<CandidateSessionData>(
      store,
      candidateSessionReadOptions(),
    );
    expect(read.sid).toBe("00000000-0000-4000-8000-000000000001");
  });
});
