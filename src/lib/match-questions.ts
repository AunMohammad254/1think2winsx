import { BALLS_PER_OVER, type InningsNumber } from '@/lib/match-engine';

/**
 * The questions an over gets (match mode). Every one is a prediction about an over that hasn't started,
 * so it can't be looked up, with Yes / No options and a line set to make both answers about as likely:
 * reading the match should beat guessing, but not by much. Only markets src/lib/match-engine.ts can
 * settle from the balls, and none about wides or no-balls (what spot-fixing targets).
 *
 * These are the built-in wordings, in English and Roman Urdu (Urdu in the Latin alphabet, as fans text it).
 * Gemini can word them better (src/lib/match-wording.ts); the markets and how they settle stay.
 */

export interface OverContext {
  innings: InningsNumber;
  /** The over the questions are about */
  over: number;
  oversPerInnings: number;
  battingTeam: string;
  /** The batting side's runs and legal balls so far this innings */
  runs: number;
  legalBalls: number;
}

export interface OverQuestion {
  market: string;
  params: Record<string, number>;
  text: string;
  /** The same question in Roman Urdu, which players see first */
  textRomanUrdu: string;
  options: string[];
}

export const YES_NO = ['Yes', 'No'];

// Below two overs the run rate says little: a typical over for the format instead
const MIN_BALLS_FOR_RUN_RATE = 2 * BALLS_PER_OVER;
const SHORT_FORMAT_OVERS = 10;
// An over's runs line stays where an over can plausibly go either way
const MIN_RUNS_LINE = 5;
const MAX_RUNS_LINE = 14;
// About half of T20 overs have 3 or more dot balls
const DOTS_LINE = 3;

/** The runs line for the over: the innings' run rate so far, rounded, or a typical over early on. */
export function runsLine(ctx: Pick<OverContext, 'runs' | 'legalBalls' | 'oversPerInnings'>): number {
  if (ctx.legalBalls < MIN_BALLS_FOR_RUN_RATE) return ctx.oversPerInnings <= SHORT_FORMAT_OVERS ? 9 : 8;
  const perOver = (ctx.runs / ctx.legalBalls) * BALLS_PER_OVER;
  return Math.min(MAX_RUNS_LINE, Math.max(MIN_RUNS_LINE, Math.round(perOver)));
}

const ROTATION = ['boundary_in_over', 'dots_at_least', 'wicket_in_over'] as const;

function question(market: string, ctx: OverContext): OverQuestion {
  const over = `over ${ctx.over}`;
  switch (market) {
    case 'over_runs_at_least': {
      const line = runsLine(ctx);
      return {
        market, params: { line }, options: YES_NO,
        text: `${ctx.battingTeam}: will ${over} go for ${line} or more runs?`,
        textRomanUrdu: `${ctx.battingTeam}: kya ${over} mein ${line} ya us se zyada runs banenge?`,
      };
    }
    case 'boundary_in_over':
      return {
        market, params: {}, options: YES_NO,
        text: `Will there be a four or a six in ${over}?`,
        textRomanUrdu: `Kya ${over} mein chauka ya chhakka lagega?`,
      };
    case 'dots_at_least':
      return {
        market, params: { line: DOTS_LINE }, options: YES_NO,
        text: `Will ${over} have ${DOTS_LINE} or more dot balls?`,
        textRomanUrdu: `Kya ${over} mein ${DOTS_LINE} ya zyada dot balls hongi?`,
      };
    default:
      return {
        market: 'wicket_in_over', params: {}, options: YES_NO,
        text: `Will a wicket fall in ${over}?`,
        textRomanUrdu: `Kya ${over} mein koi wicket giray ga?`,
      };
  }
}

/**
 * `count` questions about the over in `ctx`: always its runs, then markets in turn, so overs next to each
 * other ask different things.
 */
export function overQuestions(ctx: OverContext, count: number): OverQuestion[] {
  const markets = ['over_runs_at_least'];
  for (let i = 0; markets.length < count; i++) markets.push(ROTATION[(ctx.over + i) % ROTATION.length]);
  return markets.map((market) => question(market, ctx));
}
