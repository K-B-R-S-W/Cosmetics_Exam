import "server-only";

import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

const CANDIDATE_TOKEN_TTL_SECONDS = 4 * 60 * 60;
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export class LiveKitConfigurationError extends Error {
  constructor() {
    super("livekit_configuration_unavailable");
    this.name = "LiveKitConfigurationError";
  }
}

export type LiveKitTokenResult = {
  token: string;
  url: string;
  room: string;
  identity: string;
};

type LiveKitConfiguration = {
  apiKey: string;
  apiSecret: string;
  url: string;
};

function configured(name: "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new LiveKitConfigurationError();
  return value;
}

export function liveKitHttpUrl(websocketUrl: string): string {
  try {
    const parsed = new URL(websocketUrl);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    else if (parsed.protocol === "wss:") parsed.protocol = "https:";
    else throw new LiveKitConfigurationError();
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof LiveKitConfigurationError) throw error;
    throw new LiveKitConfigurationError();
  }
}

export function readLiveKitConfiguration(): LiveKitConfiguration & { httpUrl: string } {
  const url = configured("LIVEKIT_URL");
  return {
    url,
    apiKey: configured("LIVEKIT_API_KEY"),
    apiSecret: configured("LIVEKIT_API_SECRET"),
    httpUrl: liveKitHttpUrl(url),
  };
}

export async function buildCandidateLiveKitToken(input: {
  attemptId: string;
  examId: string;
  merCode: string;
}): Promise<LiveKitTokenResult> {
  const configuration = readLiveKitConfiguration();
  const room = `exam_${input.examId}`;
  const identity = `c_${input.attemptId}`;
  const accessToken = new AccessToken(configuration.apiKey, configuration.apiSecret, {
    identity,
    name: input.merCode,
    metadata: JSON.stringify({ attempt_id: input.attemptId, mer_code: input.merCode }),
    ttl: CANDIDATE_TOKEN_TTL_SECONDS,
  });
  accessToken.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canSubscribe: false,
    canPublishData: false,
  });
  return { token: await accessToken.toJwt(), url: configuration.url, room, identity };
}

export async function buildAdminLiveKitToken(input: {
  adminId: string;
  examId: string;
}): Promise<LiveKitTokenResult> {
  const configuration = readLiveKitConfiguration();
  const room = `exam_${input.examId}`;
  const identity = `a_${input.adminId}`;
  const accessToken = new AccessToken(configuration.apiKey, configuration.apiSecret, {
    identity,
    ttl: ADMIN_TOKEN_TTL_SECONDS,
  });
  accessToken.addGrant({
    room,
    roomJoin: true,
    hidden: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { token: await accessToken.toJwt(), url: configuration.url, room, identity };
}

export async function removeCandidateParticipant(examId: string, attemptId: string): Promise<boolean> {
  try {
    const configuration = readLiveKitConfiguration();
    const rooms = new RoomServiceClient(configuration.httpUrl, configuration.apiKey, configuration.apiSecret);
    await rooms.removeParticipant(`exam_${examId}`, `c_${attemptId}`);
    return true;
  } catch {
    return false;
  }
}
