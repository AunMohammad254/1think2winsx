/** "1,234": counts and points as the admin screens show them. */
export const formatCount = (n: number) => n.toLocaleString('en-US');

/**
 * True for 12, 12.5 and 12.34, false for 12.345. `Math.round(n * 100) === n * 100` refuses about one
 * valid value in nine (1.1 * 100 is 110.00000000000001), so this allows for floating-point noise.
 */
export function hasAtMostTwoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}
