export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  actorId?: string;
  errorCode?: string;
  itemCount?: number;
  successCount?: number;
  failureCount?: number;
}

function write(level: LogLevel, event: string, context: LogContext = {}): void {
  const entry = {
    level,
    event,
    time: new Date().toISOString(),
    request_id: context.requestId,
    route: context.route,
    status: context.status,
    duration_ms: context.durationMs,
    actor_id: context.actorId,
    error_code: context.errorCode,
    item_count: context.itemCount,
    success_count: context.successCount,
    failure_count: context.failureCount,
  };

  const serialized = JSON.stringify(entry);

  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

export const logger = {
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext) => write("warn", event, context),
  error: (event: string, context?: LogContext) => write("error", event, context),
};
