import { BALLS_PER_OVER } from '@/lib/match-engine';
import { phaseOf, type MatchSituation } from '@/lib/match-situation';

/** Every market's options are Yes / No: their Roman Urdu, which players see with the English */
const ROMAN_URDU_OPTIONS: Record<string, string> = { Yes: 'Haan', No: 'Nahi' };

/** An option in Roman Urdu, or null for one that has none */
export const romanUrduOption = (option: string): string | null => ROMAN_URDU_OPTIONS[option] ?? null;

/**
 * The questions an over's quiz can ask (match mode), built from the match situation
 * (src/lib/match-situation.ts). Every one is a Yes / No prediction about an over that hasn't started, so it
 * can't be looked up: players answer by watching. Lines are set from the situation so both answers are
 * about as likely (reading the match should beat guessing, but not by much). Only markets
 * src/lib/match-engine.ts can settle from the balls, and none about wides or no-balls (what spot-fixing
 * targets).
 *
 * Each over gets every market as a candidate, best first: the admin ticks the ones that go out (the best
 * are ticked already), or Auto sends the best. A short lead-in states the situation in everyday words, with
 * numbers counted from the balls, so players know what they are predicting without looking anything up.
 * Gemini can reword them (src/lib/match-wording.ts); what is asked and how it settles stay.
 */

/** A text in English and Roman Urdu */
export interface Phrase {
  en: string;
  ur: string;
}

export interface OverQuestion {
  market: string;
  params: Record<string, number>;
  /** The built-in wording players get, lead-in included */
  text: string;
  /** The same in Roman Urdu (Urdu in the Latin alphabet, as fans text it), which players see first */
  textRomanUrdu: string;
  options: string[];
  /** The question without its lead-in, and the lead-in: what Gemini is asked to reword */
  body: Phrase;
  lead: Phrase | null;
  /** How well it suits this over: higher goes first */
  score: number;
}

export const YES_NO = ['Yes', 'No'];

/** A question players read at a glance: one sentence of at most this many characters */
export const SIMPLE_LENGTH = 120;

const SHORT_FORMAT_OVERS = 10;
// An over's runs line stays where an over can plausibly go either way
const MIN_RUNS_LINE = 5;
const MAX_RUNS_LINE = 14;
// About half of T20 overs have 3 or more dot balls; fewer at the death, when batters swing at everything
const DOTS_LINE = 3;
const DEATH_DOTS_LINE = 2;
// A chase this close to the end makes every over's runs the story
const LATE_CHASE_BALLS = 6 * BALLS_PER_OVER;

/**
 * The runs line for the over: a typical over for the format until two overs are bowled, then the innings'
 * rate blended with the last three overs', and in a chase pulled halfway to the rate the batting side needs.
 * Rounded and kept between 5 and 14.
 */
export function runsLine(s: Pick<MatchSituation, 'runRate' | 'recentRate' | 'chase' | 'oversPerInnings'>): number {
  let line = s.runRate === null ? (s.oversPerInnings <= SHORT_FORMAT_OVERS ? 9 : 8)
    : s.recentRate === null ? s.runRate
    : (s.runRate + s.recentRate) / 2;
  if (s.chase && s.chase.ballsLeft > 0 && s.chase.needed > 0) {
    line = (line + (s.chase.needed / s.chase.ballsLeft) * BALLS_PER_OVER) / 2;
  }
  return Math.min(MAX_RUNS_LINE, Math.max(MIN_RUNS_LINE, Math.round(line)));
}

/** The dot-ball line: 3, or 2 in the death overs */
export const dotsLine = (over: number, oversPerInnings: number) => (phaseOf(over, oversPerInnings) === 'death' ? DEATH_DOTS_LINE : DOTS_LINE);

/**
 * The situation in a few everyday words, or null when there is nothing to say yet (innings 1 before its
 * first over ends). Always "after N overs", so it stays true while the quiz is out.
 */
export function leadIn(s: MatchSituation): Phrase | null {
  const team = s.battingTeam;
  if (s.chase) {
    if (s.afterOvers === 0) return { en: `${team} chase ${s.chase.target}`, ur: `${team} ko ${s.chase.target} ka target` };
    return {
      en: `After ${s.afterOvers} overs, ${team} need ${s.chase.needed} runs from ${s.chase.ballsLeft} balls`,
      ur: `${s.afterOvers} overs ke baad ${team} ko ${s.chase.ballsLeft} balls mein ${s.chase.needed} runs chahiye`,
    };
  }
  if (s.afterOvers === 0) return null;
  return {
    en: `${team} ${s.runs}/${s.wickets} after ${s.afterOvers} overs`,
    ur: `${s.afterOvers} overs ke baad ${team} ${s.runs}/${s.wickets}`,
  };
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The lead-in and the question as one sentence (or the question alone) */
export function joinWording(lead: Phrase | null, body: Phrase): { text: string; textRomanUrdu: string } {
  return lead
    ? { text: `${lead.en}: ${body.en}`, textRomanUrdu: `${lead.ur}: ${body.ur}` }
    : { text: capitalise(body.en), textRomanUrdu: capitalise(body.ur) };
}

/** Whether a wording is short enough to read at a glance, in both languages */
export const isSimple = (wording: { text: string; textRomanUrdu: string }) =>
  wording.text.length <= SIMPLE_LENGTH && wording.textRomanUrdu.length <= SIMPLE_LENGTH;

function body(market: string, over: number, line: number, team: string, withLead: boolean): Phrase {
  const o = `over ${over}`;
  switch (market) {
    case 'over_runs_at_least':
      return withLead
        ? { en: `will ${o} go for ${line} or more runs?`, ur: `kya ${o} mein ${line} ya us se zyada runs banenge?` }
        : { en: `${team}: will ${o} go for ${line} or more runs?`, ur: `${team}: kya ${o} mein ${line} ya us se zyada runs banenge?` };
    case 'boundary_in_over':
      return { en: `will there be a four or a six in ${o}?`, ur: `kya ${o} mein chauka ya chhakka lagega?` };
    case 'dots_at_least':
      return { en: `will ${o} have ${line} or more dot balls?`, ur: `kya ${o} mein ${line} ya zyada dot balls hongi?` };
    default:
      return { en: `will a wicket fall in ${o}?`, ur: `kya ${o} mein koi wicket giray ga?` };
  }
}

const MARKETS = ['over_runs_at_least', 'boundary_in_over', 'dots_at_least', 'wicket_in_over'] as const;

/**
 * How well each market suits the over. The runs question is always first (every over is about its runs,
 * more so at the death and late in a chase); boundaries suit the powerplay, dot balls the middle overs,
 * a wicket question follows a wicket or a chase running out of batters. A market asked in the over before
 * drops back, so neighbouring overs ask different things.
 */
function scoreOf(market: (typeof MARKETS)[number], s: MatchSituation, over: number, recentMarkets: readonly string[]): number {
  const phase = phaseOf(over, s.oversPerInnings);
  const repeat = recentMarkets.includes(market) ? 1.5 : 0;
  switch (market) {
    case 'over_runs_at_least':
      return 3 + (phase === 'death' || (s.chase !== null && s.chase.ballsLeft <= LATE_CHASE_BALLS) ? 1 : 0);
    case 'boundary_in_over':
      return 2 + (phase === 'powerplay' ? 1 : 0) - repeat;
    case 'dots_at_least':
      return 2 + (phase === 'middle' ? 0.5 : 0) - (phase === 'death' ? 1 : 0) - repeat;
    case 'wicket_in_over': {
      const pressure = (s.lastOver?.wickets ?? 0) > 0 || (s.chase !== null && s.wicketsInHand <= 3);
      return 1.5 + (pressure ? 1.5 : 0) + (phase === 'death' ? 0.5 : 0) - repeat;
    }
  }
}

/**
 * Every market as a question about `over`, best first (ties keep the order runs, boundary, dot balls,
 * wicket). `recentMarkets`: what the over before asked.
 */
export function overCandidates(s: MatchSituation, over: number, recentMarkets: readonly string[] = []): OverQuestion[] {
  const situation = leadIn(s);
  const candidates = MARKETS.map((market) => {
    const params: Record<string, number> = market === 'over_runs_at_least' ? { line: runsLine(s) }
      : market === 'dots_at_least' ? { line: dotsLine(over, s.oversPerInnings) }
      : {};
    // The lead-in only goes with the question when together they're short enough (long team names)
    const line = params.line ?? 0;
    let lead = situation;
    let parts = body(market, over, line, s.battingTeam, lead !== null);
    if (lead && !isSimple(joinWording(lead, parts))) {
      lead = null;
      parts = body(market, over, line, s.battingTeam, false);
    }
    return { market, params, options: YES_NO, ...joinWording(lead, parts), body: parts, lead, score: scoreOf(market, s, over, recentMarkets) };
  });
  return candidates.sort((a, b) => b.score - a.score);
}
