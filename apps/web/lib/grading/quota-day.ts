export type QuotaWindow = { start: Date; next: Date };

const zone = "America/Los_Angeles";

function parts(date: Date): Record<string, number> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zoneOffsetMs(date: Date): number {
  const p = parts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function zonedMidnight(year: number, month: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  return new Date(guess.getTime() - zoneOffsetMs(guess));
}

export function pacificQuotaWindow(now = new Date()): QuotaWindow {
  const p = parts(now);
  const start = zonedMidnight(p.year, p.month, p.day);
  const nextDate = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return { start, next: zonedMidnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate()) };
}
