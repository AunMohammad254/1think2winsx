import {
  BadgeCheck,
  Coins,
  Gift,
  Hourglass,
  Lock,
  Medal,
  Radio,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  Ticket,
  Timer,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Wifi,
  Brain,
  type LucideIcon,
} from 'lucide-react';
import { MIN_DEPOSIT_AMOUNT } from '@/types/wallet';

/**
 * Everything /how-to-play says, for the wallet on (paid 24-hour day pass), off (every quiz free) or
 * not known yet (the page is cached by Cloudflare, so it reads the flag in the browser; until then it
 * shows wording that is true either way). Keep it in step with how the game really works:
 *   - day pass: pay_quiz_access, 24 hours, the price of the quiz (src/lib/wallet/service.ts)
 *   - free entry: live match quizzes never need a day pass (migration 20261029120000_match_mode)
 *   - one lock-in per quiz, entries close when the quiz is full (src/lib/lock-in.ts, entry cap)
 *   - settlement: 1st-3rd by score win prizes or points, ties by earliest lock-in or a recorded random
 *     draw; the points pool goes to the earliest entrants who scored (src/lib/quiz-settlement.ts)
 *   - points buy prizes on /prizes; won prizes are claimed from the profile with a WhatsApp number
 */

export type WalletState = boolean | null;

export interface Step { title: string; description: string; icon: LucideIcon }
export interface Rule { title: string; description: string; icon: LucideIcon }
export interface RuleTab { id: string; label: string; icon: LucideIcon; rules: Rule[] }
export interface RewardCard { name: string; description: string; icon: LucideIcon; tier: 'grand' | 'major' | 'standard' }
export interface Tip { title: string; description: string; icon: LucideIcon; color: 'emerald' | 'amber' | 'blue' }
export interface Faq { question: string; answer: string }

export interface HowToPlayContent {
  heroLine: string;
  steps: Step[];
  rewards: RewardCard[];
  ruleTabs: RuleTab[];
  tips: Tip[];
  faqs: Faq[];
  /** The small print under the final call to action */
  badges: string[];
}

const pick = <T,>(wallet: WalletState, choices: { on: T; off: T; unknown: T }): T =>
  wallet === true ? choices.on : wallet === false ? choices.off : choices.unknown;

export function howToPlayContent(wallet: WalletState): HowToPlayContent {
  const steps: Step[] = [
    { title: 'Create your account', description: 'Sign up free with your email or Google in under a minute.', icon: UserPlus },
    ...pick<Step[]>(wallet, {
      on: [
        { title: 'Top up your wallet', description: `Deposit from ${MIN_DEPOSIT_AMOUNT} PKR with Easypaisa or JazzCash. We check it and add it to your balance.`, icon: Wallet },
        { title: 'Get a day pass', description: 'One small payment from your wallet unlocks every quiz for 24 hours. Live match quizzes are always free.', icon: Ticket },
      ],
      off: [
        { title: 'Pick a quiz', description: 'Every quiz is free to play right now. No wallet, no payment, no day pass.', icon: Search },
      ],
      unknown: [
        { title: 'Pick a quiz', description: 'Open a quiz from the Quizzes page. If it needs a day pass you see the price before paying.', icon: Search },
      ],
    }),
    { title: 'Answer & lock in', description: 'Choose your answers before the countdown ends, then tap Lock in. One entry per quiz.', icon: Lock },
    { title: 'Win & redeem', description: 'Top scorers win prizes or points. Spend points on real prizes in the Prizes shop.', icon: Trophy },
  ];

  const rewards: RewardCard[] = [
    {
      name: 'Top 3 prizes',
      description: 'The three highest scores in a quiz win the rewards set for it: a prize from our store or a bundle of points.',
      icon: Trophy,
      tier: 'grand',
    },
    {
      name: 'Points pool',
      description: 'Many quizzes also share a pool of points among the first players to lock in who score at least one answer right.',
      icon: Coins,
      tier: 'major',
    },
    {
      name: 'Prizes shop',
      description: 'Collect points across quizzes and swap them for gadgets, gift cards and more on the Prizes page.',
      icon: Gift,
      tier: 'standard',
    },
    {
      name: 'Leaderboard',
      description: 'Every point you earn moves you up the national leaderboard against fans across Pakistan.',
      icon: Medal,
      tier: 'standard',
    },
  ];

  const quizRules: Rule[] = [
    { title: 'Beat the countdown', description: 'Each quiz has its own timer. Answers locked in after "Time\'s up" are not counted.', icon: Timer },
    { title: 'One entry per quiz', description: 'You lock in once. After that your answers are final, so check them first.', icon: Target },
    { title: 'Entries can fill up', description: 'Popular quizzes take a limited number of players. Once full, later players are told entries have closed.', icon: Users },
    { title: 'Live match quizzes', description: 'During a live cricket match, new questions about the next over open as play goes on. Answer before they close.', icon: Radio },
  ];

  const entryRules: Rule[] = pick<Rule[]>(wallet, {
    on: [
      { title: 'Wallet deposits', description: `Send from ${MIN_DEPOSIT_AMOUNT} PKR by Easypaisa or JazzCash and enter the transaction ID. Your balance updates once we verify it.`, icon: Wallet },
      { title: '24-hour day pass', description: 'Paid from your wallet. One pass covers every paid quiz until it runs out; the price is shown before you pay.', icon: Ticket },
      { title: 'Free-entry quizzes', description: 'Live match quizzes, and any quiz marked free, never need a day pass.', icon: Sparkles },
      { title: 'Non-refundable', description: 'A day pass can\'t be refunded once bought, as set out in our Terms.', icon: ShieldCheck },
    ],
    off: [
      { title: 'Free to play', description: 'All quizzes are free right now. You only need a signed-in account.', icon: Sparkles },
      { title: 'No payment details', description: 'We never ask for card, Easypaisa or JazzCash details to play.', icon: ShieldCheck },
      { title: 'Real prizes', description: 'Free quizzes still pay out points and prizes exactly like before.', icon: Gift },
      { title: 'Fair for everyone', description: 'One account per player and one entry per quiz keep the competition fair.', icon: BadgeCheck },
    ],
    unknown: [
      { title: 'Free or day pass', description: 'Some quizzes are free. Others need a 24-hour day pass, and the quiz tells you before you pay.', icon: Ticket },
      { title: 'Live match quizzes', description: 'Quizzes during a live match are always free to enter.', icon: Sparkles },
      { title: 'Real prizes', description: 'Every quiz pays out points and prizes the same way.', icon: Gift },
      { title: 'Fair for everyone', description: 'One account per player and one entry per quiz keep the competition fair.', icon: BadgeCheck },
    ],
  });

  const pointsRules: Rule[] = [
    { title: 'Score = correct answers', description: 'Your rank in a quiz comes from how many questions you got right.', icon: Target },
    { title: 'Ties', description: 'Equal scores are split by who locked in first, or by a recorded random draw.', icon: Hourglass },
    { title: 'Redeem points', description: 'Spend points on prizes in the Prizes shop whenever you have enough.', icon: Gift },
    { title: 'Claiming a prize', description: 'Won a prize? Add your name, WhatsApp number and address from your profile and we arrange delivery.', icon: Smartphone },
  ];

  const ruleTabs: RuleTab[] = [
    { id: 'quiz', label: 'Quiz Rules', icon: Target, rules: quizRules },
    { id: 'entry', label: wallet === false ? 'Free Entry' : 'Entry & Wallet', icon: wallet === false ? Sparkles : Wallet, rules: entryRules },
    { id: 'points', label: 'Points & Prizes', icon: Trophy, rules: pointsRules },
  ];

  const tips: Tip[] = [
    { title: 'Lock in on time', description: 'Don\'t wait for the last second: answers that arrive after the countdown don\'t count.', icon: Timer, color: 'emerald' },
    { title: 'Check your connection', description: 'A steady signal helps your lock-in reach us quickly, especially when a quiz is busy.', icon: Wifi, color: 'amber' },
    { title: 'Follow the game', description: 'Stats, form and match news give you the edge, most of all in live match quizzes.', icon: Brain, color: 'blue' },
  ];

  const faqs: Faq[] = [
    {
      question: 'Is it free to play?',
      answer: pick(wallet, {
        on: 'Creating an account is free. Most quizzes need a 24-hour day pass paid from your wallet (the price is shown before you pay), and live match quizzes are always free.',
        off: 'Yes. Every quiz is free right now: just sign in and play. Prizes and points are paid out as usual.',
        unknown: 'Creating an account is free, and live match quizzes are always free. Other quizzes may need a 24-hour day pass; the quiz shows the price before you pay.',
      }),
    },
    ...(wallet === true
      ? [{
          question: 'How do I add money to my wallet?',
          answer: `Open Profile → Wallet, choose Easypaisa or JazzCash, send at least ${MIN_DEPOSIT_AMOUNT} PKR to the number shown and enter the transaction ID. We verify it and add it to your balance; you get a notification when it's done.`,
        }]
      : []),
    {
      question: 'Can I play the same quiz twice?',
      answer: 'No. Each player locks in once per quiz, which keeps it fair for everyone.',
    },
    {
      question: 'How are winners chosen?',
      answer: 'By score. When a quiz ends, the three highest scores win the rewards set for that quiz. Equal scores are split by who locked in first or by a recorded random draw. Many quizzes also share a points pool among the first players to lock in who answered at least one question right.',
    },
    {
      question: 'How do I claim a prize I won?',
      answer: 'You get a notification. Open your profile, find "Prizes you won" and add your name, WhatsApp number and delivery address. Our team contacts you on WhatsApp to arrange delivery.',
    },
    {
      question: 'What can I do with points?',
      answer: 'Spend them in the Prizes shop. Each prize shows how many points it costs, and points also count towards your place on the leaderboard.',
    },
  ];

  const badges = [
    pick(wallet, { on: 'Free account', off: '100% free quizzes', unknown: 'Free account' }),
    'Real prizes',
    'Fair, score-based results',
  ];

  return {
    heroLine: pick(wallet, {
      on: 'Top up once, grab a day pass, and test your sports knowledge against fans across Pakistan for real prizes.',
      off: 'Every quiz is free right now. Test your sports knowledge against fans across Pakistan and win real prizes.',
      unknown: 'Test your sports knowledge against fans across Pakistan, lock in your answers and win real prizes.',
    }),
    steps,
    rewards,
    ruleTabs,
    tips,
    faqs,
    badges,
  };
}
