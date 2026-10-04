const SINHALA_PATTERN = /[\u0D80-\u0DFF]/u;

export function containsSinhala(text: string): boolean {
  return SINHALA_PATTERN.test(text);
}

export function langFor(text: string): "si" | "en" {
  return containsSinhala(text) ? "si" : "en";
}
