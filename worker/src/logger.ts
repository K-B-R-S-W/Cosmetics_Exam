export type SchedulerLogContext = {
  exam_id?: string;
  attempt_id?: string;
  result?: string;
  reason?: string | null;
  missing?: string[];
  finalized_attempts?: number;
  changed?: number;
  eligible?: number;
  deleted?: number;
  failed?: number;
  remaining?: number;
  error_code?: string;
};

export interface SchedulerLogger {
  info(event: string, context: SchedulerLogContext): void;
  error(event: string, context: SchedulerLogContext): void;
}

function write(level: "info" | "error", event: string, context: SchedulerLogContext): void {
  const serialized = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...context,
  });

  if (level === "error") {
    console.error(serialized);
  } else {
    console.info(serialized);
  }
}

export const schedulerLogger: SchedulerLogger = {
  info: (event, context) => write("info", event, context),
  error: (event, context) => write("error", event, context),
};
