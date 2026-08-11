export function findLowestAvailableNumber(min: number, max: number, taken: Set<number>): number | null {
  for (let n = min; n <= max; n++) {
    if (!taken.has(n)) return n;
  }
  return null;
}
