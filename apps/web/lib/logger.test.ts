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

  it("allows aggregate submit counts without accepting answer content", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logger.info("candidate_submit_pending_answers", {
      itemCount: 100,
      successCount: 98,
      failureCount: 2,
    });
    const output = String(info.mock.calls[0]?.[0]);
    expect(output).toContain('"item_count":100');
    expect(output).toContain('"success_count":98');
    expect(output).toContain('"failure_count":2');
  });
});
