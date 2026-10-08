export const SCHEDULER_INTERVAL_MS = 10_000;
export const PROCTORING_INTERVAL_MS = 30_000;
export const SCHEDULER_EARLY_WINDOW_MS = 60_000;
export const HEALTH_HEARTBEAT_INTERVAL_MS = 30_000;
export const HEALTH_STALE_AFTER_MS = 60_000;
export const HEALTH_GUARD_POLL_INTERVAL_MS = 5_000;
export const HEALTH_GUARD_TAKEOVER_AFTER_MS = 65_000;
export const GRADING_IDLE_INTERVAL_MS = 30_000;
export const GRADING_ACTIVE_INTERVAL_MS = 2_000;

export type GradingKeyConfig = { label: string; key: string; dailyLimit: number };
export type GradingConfig = {
  model: "gemini-3.7-flash";
  keys: GradingKeyConfig[];
  chunkSize: number;
  reserve: number;
  slotMinIntervalMs: number;
  requestTimeoutMs: number;
  maxTries: number;
  pauseAfterMin: number;
  markStep: number;
  reviewConfidence: number;
  reviewConfidenceSinglish: number;
  maxAnswerChars: number;
  promptVersion: "g1";
  thinking?: string;
};

export const DEFAULT_GRADING_TUNING = {
  chunkSize: 10, reserve: 1, slotMinIntervalMs: 12_000, requestTimeoutMs: 90_000,
  maxTries: 4, pauseAfterMin: 15, markStep: 0.5, reviewConfidence: 0.6,
  reviewConfidenceSinglish: 0.75, maxAnswerChars: 6_000, promptVersion: "g1" as const,
};

export type WorkerConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  grading: GradingConfig;
};

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required worker environment variable: ${name}`);
  }
  return value;
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const supabaseUrl = required(environment, "SUPABASE_URL");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");

  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL or localhost URL");
  }

  const model = required(environment, "GEMINI_MODEL");
  if (model !== "gemini-3.7-flash") throw new Error("GEMINI_MODEL must be gemini-3.7-flash");
  const rawLimits = Object.fromEntries(required(environment, "GEMINI_DAILY_LIMITS").split(",").map((entry) => {
    const [label, limit] = entry.split(":"); return [label?.trim(), Number(limit?.trim())];
  }));
  const keys = [environment.GEMINI_KEY_1, environment.GEMINI_KEY_2, environment.GEMINI_KEY_3]
    .flatMap((key, index) => {
      const value = key?.trim();
      if (!value) return [];
      const dailyLimit = rawLimits[`key${index + 1}`];
      if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) throw new Error(`Missing positive daily limit for key${index + 1}`);
      return [{ label: `key${index + 1}`, key: value, dailyLimit }];
    });
  if (keys.length === 0) throw new Error("At least one Gemini key is required");
  const integer = (name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = environment[name] === undefined ? fallback : Number(environment[name]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} is invalid`);
    return value;
  };
  const decimal = (name: string, fallback: number, min: number, max: number) => {
    const value = environment[name] === undefined ? fallback : Number(environment[name]);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} is invalid`);
    return value;
  };
  const promptVersion = environment.GRADING_PROMPT_VERSION?.trim() || "g1";
  if (promptVersion !== "g1") throw new Error("GRADING_PROMPT_VERSION must be g1");
  return {
    supabaseUrl, serviceRoleKey,
    grading: {
      model, keys,
      chunkSize: integer("GRADING_CHUNK_SIZE", 10, 1, 10),
      reserve: integer("GRADING_RESERVE", 1, 0),
      slotMinIntervalMs: integer("GRADING_SLOT_MIN_INTERVAL_MS", 12_000, 0),
      requestTimeoutMs: integer("GRADING_REQUEST_TIMEOUT_MS", 90_000, 1_000),
      maxTries: integer("GRADING_MAX_TRIES", 4, 1, 10),
      pauseAfterMin: integer("GRADING_PAUSE_AFTER_MIN", 15, 1, 1_440),
      markStep: decimal("GRADING_MARK_STEP", 0.5, 0.01, 10),
      reviewConfidence: decimal("REVIEW_CONFIDENCE", 0.6, 0, 1),
      reviewConfidenceSinglish: decimal("REVIEW_CONFIDENCE_SINGLISH", 0.75, 0, 1),
      maxAnswerChars: integer("GRADING_MAX_ANSWER_CHARS", 6_000, 1, 20_000),
      promptVersion,
      thinking: environment.GEMINI_THINKING?.trim() || undefined,
    },
  };
}
