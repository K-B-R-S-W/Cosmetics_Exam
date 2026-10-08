import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ApiError } from "@/lib/api";
import { throwGradingRpcError } from "./server";

describe("throwGradingRpcError", () => {
  it("maps known errors without leaking unknown database text", () => {
    expect(() => throwGradingRpcError({ message: "regrade_in_progress", details: "secret" })).toThrow(ApiError);
    expect(() => throwGradingRpcError({ message: "syntax error with candidate text", details: "secret" })).toThrow("grading_database_error");
  });
});
