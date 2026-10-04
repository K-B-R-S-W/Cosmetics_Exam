import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET } from "./route";

describe("GET /api/time", () => {
  it("returns the server clock with no-store and a request id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_759_300_000_000);
    const response = await GET();
    expect(await response.json()).toEqual({ server_time_ms: 1_759_300_000_000 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  });
});
