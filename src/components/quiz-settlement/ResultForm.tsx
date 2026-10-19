import type { SettlementQuestion } from '@/lib/quiz-settlement';

/** The quiz's result: the correct option of every question. */
export function ResultForm({
  questions,
  answers,
  onPick,
  disabled,
}: {
  questions: SettlementQuestion[];
  answers: Record<string, number>;
  onPick: (questionId: string, option: number) => void;
  disabled: boolean;
}) {
  return (
    <ol className="space-y-4">
      {questions.map((q, i) => (
        <li key={q.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 font-medium text-white">{i + 1}. {q.text}</p>
          <div role="radiogroup" aria-label={`Correct answer for: ${q.text}`} className="grid gap-2 sm:grid-cols-2">
            {q.options.map((option, index) => {
              const picked = answers[q.id] === index;
              return (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={disabled}
                  onClick={() => onPick(q.id, index)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60 ${picked
                    ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                    : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/30'}`}
                >
                  {picked ? '✓ ' : ''}{option}
                </button>
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}
