"use client";

import { useCallback, useState } from "react";

export const PAPER_RETRY_DELAY_MS = 5_000;
export const PAPER_RETRY_NOTICE_AFTER = 6;
export const PAPER_RETRY_NOTICE = "This is taking longer than expected. Tell the exam team if this continues.";

export function usePaperRetryTracker() {
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const recordFailure = useCallback(() => {
    setConsecutiveFailures((current) => current + 1);
  }, []);
  const resetFailures = useCallback(() => {
    setConsecutiveFailures(0);
  }, []);
  return {
    consecutiveFailures,
    recordFailure,
    resetFailures,
    showTakingLonger: consecutiveFailures >= PAPER_RETRY_NOTICE_AFTER,
  };
}
