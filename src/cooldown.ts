export function isOnCooldown(lastAt: number | undefined, now: number, cooldownMs: number): boolean {
  return lastAt !== undefined && now - lastAt < cooldownMs;
}
