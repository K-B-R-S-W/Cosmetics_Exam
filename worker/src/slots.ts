import type { GradingKeyConfig } from "./config";

export type SlotState = GradingKeyConfig & {
  usedToday: number; cooldownUntil: number; disabled: boolean; lastCallAt: number; inFlight: boolean; rateLimits: number;
};

export class SlotManager {
  readonly slots: SlotState[];
  constructor(keys: GradingKeyConfig[], private reserve: number, private minIntervalMs: number) {
    this.slots = keys.map((key) => ({ ...key, usedToday: 0, cooldownUntil: 0, disabled: false, lastCallAt: 0, inFlight: false, rateLimits: 0 }));
  }
  rebuildUsage(counts: Record<string, number>): void {
    for (const slot of this.slots) slot.usedToday = counts[slot.label] ?? 0;
  }
  private eligible(slot: SlotState, now: number): boolean {
    return !slot.disabled && !slot.inFlight && slot.cooldownUntil <= now
      && now - slot.lastCallAt >= this.minIntervalMs
      && slot.usedToday < Math.max(0, slot.dailyLimit - this.reserve);
  }
  available(now = Date.now(), excludeLabel?: string): SlotState | null {
    return this.slots.filter((slot) => slot.label !== excludeLabel && this.eligible(slot, now))
      .sort((left, right) => left.usedToday / left.dailyLimit - right.usedToday / right.dailyLimit)[0] ?? null;
  }
  acquire(now = Date.now(), preferredLabel?: string, excludeLabel?: string): SlotState | null {
    const preferred = preferredLabel ? this.slots.find((slot) => slot.label === preferredLabel && this.eligible(slot, now)) : undefined;
    const slot = preferred ?? (preferredLabel ? null : (this.available(now, excludeLabel) ?? (excludeLabel ? this.available(now) : null)));
    if (slot) slot.inFlight = true; return slot;
  }
  release(label: string): void { const slot = this.slots.find((item) => item.label === label); if (slot) slot.inFlight = false; }
  nextAvailableAt(now = Date.now()): number {
    const candidates = this.slots.filter((slot) => !slot.disabled && slot.usedToday < Math.max(0, slot.dailyLimit - this.reserve));
    if (!candidates.length) return Number.POSITIVE_INFINITY;
    return Math.min(...candidates.map((slot) => Math.max(now, slot.cooldownUntil, slot.lastCallAt + this.minIntervalMs)));
  }
  markCall(label: string, now = Date.now()): void {
    const slot = this.slots.find((item) => item.label === label);
    if (slot) { slot.usedToday += 1; slot.lastCallAt = now; slot.rateLimits = 0; }
  }
  recordRateLimit(label: string): number { const slot = this.slots.find((item) => item.label === label); if (!slot) return 0; const prior = slot.rateLimits; slot.rateLimits += 1; return prior; }
  cooldown(label: string, until: number): void {
    const slot = this.slots.find((item) => item.label === label); if (slot) slot.cooldownUntil = until;
  }
  disable(label: string): void {
    const slot = this.slots.find((item) => item.label === label); if (slot) slot.disabled = true;
  }
}
