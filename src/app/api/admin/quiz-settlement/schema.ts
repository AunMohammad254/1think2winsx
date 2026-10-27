import { z } from 'zod';
import { hasAtMostTwoDecimals } from '@/lib/numbers';
import { MAX_POINTS_POOL } from '@/lib/quiz-entries';

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
 * Percentage of the entrants who share the quiz's points pool: the earliest who scored get it in
 * random amounts. 0 (don't pay the pool) to 100, with at most two decimals. settle_quiz checks the same.
 */
export const poolPercentSchema = z
  .number()
  .min(0, 'The pool percentage must be 0 to 100')
  .max(100, 'The pool percentage must be 0 to 100')
  .refine(hasAtMostTwoDecimals, { message: 'The pool percentage can have at most two decimals' })
  .default(0);

/**
 * Points each of those entrants gets, instead of random shares: a whole number, at most the quiz's
 * pool, which also caps how many are paid. 0 (the default) splits the whole pool at random.
 * settle_quiz checks the same, and that the pool covers it.
 */
export const poolEachSchema = z
  .number()
  .int('Points each must be a whole number')
  .min(0, 'Points each must be 0 or more')
  .max(MAX_POINTS_POOL, `Points each cannot exceed ${MAX_POINTS_POOL.toLocaleString('en-US')}`)
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
