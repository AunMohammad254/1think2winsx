import { STAGE_LABELS, type QuizStage } from '@/lib/quiz-stage';

const STYLES: Record<QuizStage, string> = {
  upcoming: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  awaiting_result: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ready_to_settle: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  settled: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

export function StageBadge({ stage }: { stage: QuizStage }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLES[stage]}`}>
      {stage === 'open' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />}
      {STAGE_LABELS[stage]}
    </span>
  );
}
