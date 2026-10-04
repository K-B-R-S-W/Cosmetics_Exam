import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readCandidateJson } from "./candidate-api";

describe("readCandidateJson", () => {
  it("enforces the default 64 KiB limit before parsing", async () => {
    const request = new Request("http://localhost/api/example", { method: "POST", headers: { "Content-Length": "65537" }, body: "{}" });
    await expect(readCandidateJson(request)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
  });
  it("returns the standard validation error for malformed JSON", async () => {
    const request = new Request("http://localhost/api/example", { method: "POST", body: "{" });
    await expect(readCandidateJson(request)).rejects.toMatchObject({ code: "validation_failed", status: 400 });
  });
});
