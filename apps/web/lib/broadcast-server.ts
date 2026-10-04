import "server-only";

import { logger } from "@/lib/logger";

export type ExamBroadcast = {
  type: "exam_started" | "exam_ended" | "time_updated" | "attempt_changed" | "message";
  attempt_id?: string;
};

/** Uses Supabase Realtime's single-message REST Broadcast endpoint. */
export async function publishExamBroadcast(
  examId: string,
  payload: ExamBroadcast,
): Promise<void> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !key) throw new Error("realtime_not_configured");
    const topic = encodeURIComponent(`exam:${examId}`);
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/realtime/v1/api/broadcast/${topic}/events/exam`,
      {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) throw new Error("realtime_publish_failed");
  } catch {
    logger.warn("realtime_broadcast_failed", {
      route: "publishExamBroadcast",
      errorCode: "broadcast_failed",
    });
  }
}
