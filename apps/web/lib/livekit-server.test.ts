import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";

vi.mock("server-only", () => ({}));

import {
  buildAdminLiveKitToken,
  buildCandidateLiveKitToken,
  LiveKitConfigurationError,
  liveKitHttpUrl,
  readLiveKitConfiguration,
} from "@/lib/livekit-server";

const SECRET = "synthetic-livekit-secret-32-chars-minimum";

beforeEach(() => {
  process.env.LIVEKIT_URL = "ws://localhost:7880";
  process.env.LIVEKIT_API_KEY = "devkey";
  process.env.LIVEKIT_API_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

describe("LiveKit server configuration", () => {
  it("converts WebSocket URLs for future RoomServiceClient calls", () => {
    expect(liveKitHttpUrl("ws://localhost:7880")).toBe("http://localhost:7880");
    expect(liveKitHttpUrl("wss://video.example.test/")).toBe("https://video.example.test");
    expect(readLiveKitConfiguration()).toEqual({
      url: "ws://localhost:7880",
      httpUrl: "http://localhost:7880",
      apiKey: "devkey",
      apiSecret: SECRET,
    });
  });

  it("fails closed without exposing which secret is absent", () => {
    delete process.env.LIVEKIT_API_SECRET;
    expect(() => readLiveKitConfiguration()).toThrow(LiveKitConfigurationError);
    try {
      readLiveKitConfiguration();
    } catch (error) {
      expect(String(error)).not.toContain("LIVEKIT_API_SECRET");
      expect(String(error)).not.toContain(SECRET);
    }
  });

  it("rejects non-WebSocket URLs", () => {
    expect(() => liveKitHttpUrl("https://localhost:7880")).toThrow(LiveKitConfigurationError);
  });
});

describe("LiveKit token grants", () => {
  it("builds the exact candidate identity, metadata, grants and four-hour TTL", async () => {
    const result = await buildCandidateLiveKitToken({
      attemptId: "10000000-0000-4000-8000-000000000001",
      examId: "20000000-0000-4000-8000-000000000002",
      merCode: "MER-0042",
    });
    const claims = await new TokenVerifier("devkey", SECRET).verify(result.token);
    expect(result).toEqual(expect.objectContaining({
      url: "ws://localhost:7880",
      room: "exam_20000000-0000-4000-8000-000000000002",
      identity: "c_10000000-0000-4000-8000-000000000001",
    }));
    expect(claims.sub).toBe(result.identity);
    expect(claims.name).toBe("MER-0042");
    expect(JSON.parse(claims.metadata ?? "null")).toEqual({
      attempt_id: "10000000-0000-4000-8000-000000000001",
      mer_code: "MER-0042",
    });
    expect(claims.video).toEqual(expect.objectContaining({
      room: result.room,
      roomJoin: true,
      canPublish: true,
      canPublishSources: ["camera", "microphone"],
      canSubscribe: false,
      canPublishData: false,
    }));
    expect(Number(claims.exp) - Number(claims.nbf)).toBe(4 * 60 * 60);
  });

  it("builds a hidden subscribe-only admin token with a twelve-hour TTL", async () => {
    const result = await buildAdminLiveKitToken({
      adminId: "30000000-0000-4000-8000-000000000003",
      examId: "20000000-0000-4000-8000-000000000002",
    });
    const claims = await new TokenVerifier("devkey", SECRET).verify(result.token);
    expect(result.identity).toBe("a_30000000-0000-4000-8000-000000000003");
    expect(claims.video).toEqual(expect.objectContaining({
      room: result.room,
      roomJoin: true,
      hidden: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    }));
    expect(claims.name).toBeUndefined();
    expect(Number(claims.exp) - Number(claims.nbf)).toBe(12 * 60 * 60);
  });
});
