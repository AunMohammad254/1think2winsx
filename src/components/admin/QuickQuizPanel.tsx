'use client';

import { useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DateTimePicker from '@/components/ui/DateTimePicker';
import { createQuiz } from '@/actions/quiz-actions';
import { CreateQuizInputSchema, defaultQuiz } from '@/lib/schemas/QuizFormSchema';

/** What happens to the quiz once it is saved: pushed to live viewers now, scheduled, or kept as a draft. */
export type LaunchMode = 'live' | 'schedule' | 'draft';

interface QuickQuestion { text: string; options: string[]; correct: number | null }

const blankQuestion = (): QuickQuestion => ({ text: '', options: ['', ''], correct: null });
const MAX_OPTIONS = 6;

const MODES = [
    { mode: 'live', label: 'Go live now', hint: 'Published and pushed to live viewers as soon as it is saved.', Icon: Zap, submit: 'Create & go live' },
    { mode: 'schedule', label: 'Schedule', hint: 'Goes live on its own at the time you pick.', Icon: Clock, submit: 'Create & schedule' },
    { mode: 'draft', label: 'Save as draft', hint: "Players don't see it until you publish it.", Icon: Save, submit: 'Save draft' },
] as const;

const STATUS: Record<LaunchMode, 'active' | 'scheduled' | 'draft'> = { live: 'active', schedule: 'scheduled', draft: 'draft' };

const field = 'w-full rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500/50 focus:outline-none';
const iconButton = 'shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white';

/**
 * The quiz list's "Quick quiz": a title and a few questions, then go live now, schedule or save a draft,
 * in one step. Everything else takes the full form's defaults, and Edit Quiz changes it later. What was
 * typed stays while the panel is closed, until a quiz is saved.
 */
export default function QuickQuizPanel({ open, onOpenChange, onSaved }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called once a quiz is saved, to refresh the list */
    onSaved: () => void;
}) {
    const [title, setTitle] = useState('');
    const [quizType, setQuizType] = useState<'normal' | 'predictable'>('normal');
    const [duration, setDuration] = useState(String(defaultQuiz.duration));
    const [pointsPool, setPointsPool] = useState('');
    const [questions, setQuestions] = useState<QuickQuestion[]>([blankQuestion()]);
    const [mode, setMode] = useState<LaunchMode>('live');
    const [startsAt, setStartsAt] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const editQuestion = (index: number, change: Partial<QuickQuestion>) =>
        setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...change } : q)));
    const editOption = (index: number, option: number, text: string) =>
        editQuestion(index, { options: questions[index].options.map((o, j) => (j === option ? text : o)) });
    const removeOption = (index: number, option: number) => {
        const { options, correct } = questions[index];
        // The correct answer stays on the same option: cleared if that option goes, shifted if one before it goes
        const kept = correct === option ? null : correct !== null && correct > option ? correct - 1 : correct;
        editQuestion(index, { options: options.filter((_, j) => j !== option), correct: kept });
    };

    const save = async () => {
        if (saving) return;
        const { questions: _defaultQuestions, ...defaults } = defaultQuiz;
        const input = {
            ...defaults,
            title: title.trim(),
            quizType,
            duration: Number(duration),
            pointsPool: pointsPool.trim() === '' ? 0 : Number(pointsPool),
            status: STATUS[mode],
            // The picker's local time as an absolute instant, converted here in the admin's browser (lib/schedule-time)
            startsAt: mode === 'schedule' && startsAt ? new Date(startsAt).toISOString() : null,
            questions: questions.map((q) => ({
                text: q.text.trim(),
                options: q.options.map((text, i) => ({ text: text.trim(), isCorrect: quizType === 'normal' && q.correct === i })),
                correctOption: quizType === 'normal' ? q.correct : null,
                status: 'active' as const,
            })),
        };
        const parsed = CreateQuizInputSchema.safeParse(input);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            setError(`${issue.path[0] === 'questions' ? `Question ${Number(issue.path[1]) + 1}: ` : ''}${issue.message}`);
            return;
        }
        if (input.startsAt && new Date(input.startsAt).getTime() <= Date.now()) {
            setError('Pick a time in the future');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const result = await createQuiz(parsed.data, { goLive: mode === 'live' });
            if (!result.success) {
                setError(result.error);
                return;
            }
            // Saved but not pushed: the quiz exists, so the panel closes rather than offer to create it twice
            if (mode === 'live' && !result.data?.pushedAt) toast.error(result.message);
            else toast.success(result.message);
            setTitle('');
            setPointsPool('');
            setQuestions([blankQuestion()]);
            setStartsAt('');
            onSaved();
            onOpenChange(false);
        } catch {
            setError('Saving the quiz failed. Check your connection and try again.');
        } finally {
            setSaving(false);
        }
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void save();
        }
    };

    const chosen = MODES.find((m) => m.mode === mode)!;

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
            <DialogContent className="glass-card glass-border max-h-[90vh] max-w-2xl overflow-y-auto" onKeyDown={onKeyDown}>
                <DialogHeader>
                    <DialogTitle className="text-white">Quick quiz</DialogTitle>
                    <DialogDescription className="text-gray-300">
                        A title and questions, then go live, schedule or save a draft. Edit the quiz later for prizes, entry limits and the rest.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="block text-sm text-gray-300">
                            Title
                            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PSL final: next over" className={`${field} mt-1`} />
                        </label>
                        <div role="group" aria-label="Quiz type" className="flex rounded-lg border border-white/10 bg-gray-900/80 p-1">
                            {(['normal', 'predictable'] as const).map((type) => (
                                <button key={type} type="button" aria-pressed={quizType === type} onClick={() => setQuizType(type)}
                                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${quizType === type ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-sm text-gray-300">
                            Duration (minutes)
                            <input type="number" min={1} max={180} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} className={`${field} mt-1`} />
                        </label>
                        <label className="block text-sm text-gray-300">
                            Points pool (optional)
                            <input type="number" min={0} inputMode="numeric" placeholder="0" value={pointsPool} onChange={(e) => setPointsPool(e.target.value)} className={`${field} mt-1`} />
                        </label>
                    </div>

                    <div className="space-y-3">
                        {questions.map((q, i) => (
                            <fieldset key={i} className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                                <legend className="sr-only">Question {i + 1}</legend>
                                <div className="flex items-center gap-2">
                                    <input aria-label={`Question ${i + 1}`} value={q.text} placeholder={`Question ${i + 1}`}
                                        onChange={(e) => editQuestion(i, { text: e.target.value })} className={field} />
                                    {questions.length > 1 && (
                                        <button type="button" aria-label={`Remove question ${i + 1}`} className={iconButton}
                                            onClick={() => setQuestions((prev) => prev.filter((_, j) => j !== i))}>
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                                {q.options.map((option, j) => (
                                    <div key={j} className="flex items-center gap-2 pl-2">
                                        {quizType === 'normal' && (
                                            <input type="radio" name={`quick-correct-${i}`} aria-label={`Option ${j + 1} of question ${i + 1} is correct`}
                                                title="The correct option" checked={q.correct === j} onChange={() => editQuestion(i, { correct: j })}
                                                className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-500" />
                                        )}
                                        <input aria-label={`Question ${i + 1}, option ${j + 1}`} value={option} placeholder={`Option ${j + 1}`}
                                            onChange={(e) => editOption(i, j, e.target.value)} className={field} />
                                        {q.options.length > 2 && (
                                            <button type="button" aria-label={`Remove option ${j + 1} of question ${i + 1}`} className={iconButton}
                                                onClick={() => removeOption(i, j)}>
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {q.options.length < MAX_OPTIONS && (
                                    <button type="button" onClick={() => editQuestion(i, { options: [...q.options, ''] })}
                                        className="ml-2 text-xs text-purple-300 hover:text-purple-200">
                                        + Add option
                                    </button>
                                )}
                            </fieldset>
                        ))}
                        <button type="button" onClick={() => setQuestions((prev) => [...prev, blankQuestion()])}
                            className="flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200">
                            <Plus className="h-4 w-4" />
                            Add question
                        </button>
                        <p className="text-xs text-gray-500">
                            {quizType === 'normal'
                                ? 'Tick the correct option of each question.'
                                : 'A prediction has no answer key: enter the result in Settle Quizzes once it is known.'}
                        </p>
                    </div>

                    <div role="radiogroup" aria-label="When it goes live" className="grid gap-2 sm:grid-cols-3">
                        {MODES.map(({ mode: m, label, hint, Icon }) => (
                            <label key={m} className={`cursor-pointer rounded-xl border p-3 transition-colors ${mode === m
                                ? 'border-purple-400 bg-purple-500/15' : 'border-white/10 bg-white/5 hover:border-white/25'}`}>
                                <input type="radio" name="quick-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                                <span className="flex items-center gap-2 text-sm font-medium text-white"><Icon className="h-4 w-4" />{label}</span>
                                <span className="mt-1 block text-xs text-gray-400">{hint}</span>
                            </label>
                        ))}
                    </div>
                    {mode === 'schedule' && (
                        <DateTimePicker id="quick-starts-at" value={startsAt} onChange={setStartsAt} placeholder="Pick the start time" />
                    )}

                    {error && (
                        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-900/30 p-3 text-sm text-red-200">{error}</p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <span className="hidden text-xs text-gray-500 sm:inline">Ctrl + Enter saves</span>
                        <div className="ml-auto flex gap-2">
                            <button type="button" disabled={saving} onClick={() => onOpenChange(false)}
                                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
                                Cancel
                            </button>
                            <button type="button" disabled={saving} onClick={save}
                                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:from-pink-500 hover:to-purple-500 disabled:opacity-60">
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <chosen.Icon className="h-4 w-4" />}
                                {saving ? 'Saving…' : chosen.submit}
                            </button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
