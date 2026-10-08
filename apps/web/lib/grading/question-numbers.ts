export function questionNumbers(
  questionIds: readonly string[],
  positions: ReadonlyMap<string, number>,
): number[] {
  return questionIds
    .map((id) => positions.get(id))
    .filter((position): position is number => typeof position === "number")
    .map((position) => position + 1)
    .sort((left, right) => left - right);
}

export function formatQuestionNumbers(numbers: readonly number[], separator = ", "): string {
  return numbers.join(separator);
}
