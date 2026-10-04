export const BATCH_THREE_NOTE = "Answers are not saved yet (Phase 2 batch 3)";

export function SaveIndicator() {
  return <p role="status" className="text-sm text-warn">{BATCH_THREE_NOTE}</p>;
}
