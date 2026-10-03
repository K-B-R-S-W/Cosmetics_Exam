import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, type LogContext } from "./logger";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes only allowlisted metadata", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const unsafeContext = {
      route: "/api/auth/login",
      status: 400,
      requestBody: { nic: "sensitive" },
    } as LogContext;

    logger.info("request_complete", unsafeContext);

    const output = String(info.mock.calls[0]?.[0]);
    expect(output).toContain('"route":"/api/auth/login"');
    expect(output).not.toContain("requestBody");
    expect(output).not.toContain("sensitive");
  });
});
