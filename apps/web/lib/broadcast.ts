"use client";

import { useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function useExamBroadcast(examId: string | null, onNudge: () => void): void {
  useEffect(() => {
    if (!examId) return;
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`exam:${examId}`)
      .on("broadcast", { event: "exam" }, () => onNudge())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onNudge();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [examId, onNudge]);
}
