export function distance2D(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x1 - x2, z1 - z2);
}
