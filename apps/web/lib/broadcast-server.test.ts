import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));

import { publishExamBroadcast } from "./broadcast-server";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-secret";
  mocks.warn.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("publishExamBroadcast", () => {
  it("uses the single-message Realtime REST endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await publishExamBroadcast("00000000-0000-4000-8000-000000000001", { type: "exam_started" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://synthetic.supabase.co/realtime/v1/api/broadcast/exam%3A00000000-0000-4000-8000-000000000001/events/exam",
      expect.objectContaining({ method: "POST", headers: { apikey: "synthetic-secret", "Content-Type": "application/json" } }),
    );
  });
  it("logs and never throws when publishing fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(publishExamBroadcast("exam", { type: "message" })).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith("realtime_broadcast_failed", expect.objectContaining({ errorCode: "broadcast_failed" }));
  });
});
