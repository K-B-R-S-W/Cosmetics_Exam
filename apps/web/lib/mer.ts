export const MER_MAX_LENGTH = 64;

export function normalizeMer(value: string): string {
  return value.trim().toUpperCase();
}
