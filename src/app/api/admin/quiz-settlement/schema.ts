import { z } from 'zod';

/** Up to one reward per place 1-3: points (1 to 100,000) or one prize. settle_quiz checks the same. */
export const rewardsSchema = z
  .array(
    z.union([
      z.object({ rank: z.number().int().min(1).max(3), points: z.number().int().min(1).max(100_000) }).strict(),
      z.object({ rank: z.number().int().min(1).max(3), prizeId: z.string().min(1) }).strict(),
    ]),
  )
  .max(3)
  .refine((rewards) => new Set(rewards.map((r) => r.rank)).size === rewards.length, {
    message: 'Each place (1st, 2nd, 3rd) can have one reward',
  });

/**
 * Share of the quiz's points pool split at random among the entrants who scored: 0 (none) to 100,
 * with at most two decimals. settle_quiz checks the same.
 */
export const poolPercentSchema = z
  .number()
  .min(0, 'The pool share must be 0 to 100 percent')
  .max(100, 'The pool share must be 0 to 100 percent')
  .refine((n) => Math.round(n * 100) === n * 100, { message: 'The pool share can have at most two decimals' })
  .default(0);

const STATUS: Record<string, number> = {
  not_found: 404,
  already_settled: 409,
  result_missing: 409,
  out_of_stock: 409,
};

/** HTTP status for a settle_quiz failure code (`invalid` and anything unknown: 400). */
export function settleErrorStatus(code: string): number {
  return STATUS[code] ?? 400;
}
