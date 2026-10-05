export const CLIENT_EVENT_TYPES = [
  "TAB_HIDDEN", "FOCUS_LOST", "FULLSCREEN_EXIT", "VIEWPORT_CHANGED",
  "MULTI_SCREEN", "CAMERA_LOST", "MIC_LOST", "COPY", "PASTE",
  "CONTEXT_MENU", "RELOAD",
] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const COUNTING_TYPES = new Set<ClientEventType>([
  "TAB_HIDDEN", "FOCUS_LOST", "FULLSCREEN_EXIT", "VIEWPORT_CHANGED",
  "MULTI_SCREEN", "CAMERA_LOST", "MIC_LOST", "RELOAD",
]);

export const SNAPSHOT_TYPES = new Set<ClientEventType>([
  "TAB_HIDDEN", "FOCUS_LOST", "FULLSCREEN_EXIT", "VIEWPORT_CHANGED", "MULTI_SCREEN",
]);

export const ATTENTION_TYPES = new Set<ClientEventType>([
  "TAB_HIDDEN", "FOCUS_LOST", "FULLSCREEN_EXIT", "VIEWPORT_CHANGED",
]);

export function isSnapshotEligible(type: ClientEventType): boolean {
  return SNAPSHOT_TYPES.has(type);
}
