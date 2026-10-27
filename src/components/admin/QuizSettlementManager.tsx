'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCSRFToken } from '@/lib/csrf';
import { STAGE_LABELS, type QuizStage } from '@/lib/quiz-stage';
import type { Reward, SettlementDetail, SettlementPrize, SettlementQuiz, SettleResult, TieRule } from '@/lib/quiz-settlement';
import { StageBadge } from '@/components/quiz-settlement/StageBadge';
import { ResultForm } from '@/components/quiz-settlement/ResultForm';
import { EMPTY_REWARD, RewardsEditor, toRewards, type RewardDraft } from '@/components/quiz-settlement/RewardsEditor';
import { NO_POOL, PoolEditor, poolPlaces, toPoolShare, type PoolDraft } from '@/components/quiz-settlement/PoolEditor';
import { WinnersTable } from '@/components/quiz-settlement/WinnersTable';
import { formatCount } from '@/lib/numbers';

type Filter = 'all' | QuizStage;
const FILTERS: Filter[] = ['all', 'open', 'awaiting_result', 'ready_to_settle', 'settled'];
type Preview = Extract<SettleResult, { success: true }>;
type Message = { type: 'success' | 'error'; text: string };

const NO_REWARDS: RewardDraft[] = [EMPTY_REWARD, EMPTY_REWARD, EMPTY_REWARD];
const TIE_RULES: Record<string, string> = { random: 'Fair random draw', earliest: 'Earliest submission', legacy: 'Old lucky draw' };

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const fmt = formatCount;
const entries = (q: SettlementQuiz) => `${fmt(q.attempts)} / ${fmt(q.maxEntries)} players${q.attempts >= q.maxEntries ? ' · entries closed' : ''}`;

const pointsEach = (each: number) => `${fmt(each)} ${each === 1 ? 'point' : 'points'} each`;

/**
 * "50,000 pool points shared at random among the first 400 players who scored (20% of 2,000 entrants), 1 to 260 points each."
 * or, with points each, "100 pool points, 1 point each, for the first 100 players who scored (20% of 2,000 entrants, as many as the pool covers)."
 */
function poolLine(result: Preview): string | null {
  const pool = result.pool;
  if (!pool || pool.percent <= 0) return null;
  if (pool.paid === 0) return `Points pool (first ${pool.percent}%): no entrant scored, so nothing is shared.`;
  const each = pool.each ?? 0;
  if (each > 0) {
    const capped = pool.places < poolPlaces(result.participants, pool.percent) ? ', as many as the pool covers' : '';
    return `${fmt(pool.paid)} pool points, ${pointsEach(each)}, for the first ${fmt(pool.recipients)} players who scored ` +
      `(${pool.percent}% of ${fmt(result.participants)} entrants${capped}).`;
  }
  return `${fmt(pool.paid)} pool points shared at random among the first ${fmt(pool.recipients)} players who scored ` +
    `(${pool.percent}% of ${fmt(result.participants)} entrants), ${fmt(pool.min)} to ${fmt(pool.max)} points each.`;
}
const pkTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });

async function getJson(url: string, fallback: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

async function postJson(url: string, body: unknown, fallback: string) {
  const token = await getCSRFToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token || '' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

/**
 * Admin "Settle quizzes": each quiz moves Open -> Awaiting result -> Ready to settle -> Settled.
 * The admin saves the result, sets a reward (points or a prize) for 1st-3rd place, previews the exact
 * winners, and settles once.
 */
export default function QuizSettlementManager() {
  const [quizzes, setQuizzes] = useState<SettlementQuiz[]>([]);
  const [prizes, setPrizes] = useState<SettlementPrize[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SettlementDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [editingResult, setEditingResult] = useState(false);
  const [confirmResult, setConfirmResult] = useState(false);
  const [drafts, setDrafts] = useState<RewardDraft[]>(NO_REWARDS);
  const [tieRule, setTieRule] = useState<TieRule>('random');
  const [pool, setPool] = useState<PoolDraft>(NO_POOL);
  const [preview, setPreview] = useState<{ result: Preview; rewards: Reward[]; poolPercent: number; poolEach: number; key: string } | null>(null);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await getJson('/api/admin/quiz-settlement', 'Failed to load quizzes');
      setQuizzes(data.quizzes);
      setPrizes(data.prizes);
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Failed to load quizzes') });
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (quizId: string) => {
    setLoadingDetail(true);
    try {
      const data: SettlementDetail = await getJson(`/api/admin/quiz-settlement?quizId=${encodeURIComponent(quizId)}`, 'Failed to load the quiz');
      setDetail(data);
      setAnswers(Object.fromEntries(data.questions.flatMap((q) => (q.correctOption === null ? [] : [[q.id, q.correctOption]]))));
    } catch (e) {
      setDetail(null);
      setMessage({ type: 'error', text: errorText(e, 'Failed to load the quiz') });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const select = (quizId: string) => {
    if (quizId === selectedId) return;
    setSelectedId(quizId);
    setDetail(null);
    setEditingResult(false);
    setConfirmResult(false);
    setDrafts(NO_REWARDS);
    setTieRule('random');
    setPool(NO_POOL);
    setPreview(null);
    setConfirmSettle(false);
    setMessage(null);
    loadDetail(quizId);
  };

  const refresh = (quizId: string) => Promise.all([loadList(), loadDetail(quizId)]);

  const saveResult = async (quiz: SettlementQuiz) => {
    setBusy(true);
    setMessage(null);
    try {
      await postJson('/api/admin/quiz-settlement/result', { quizId: quiz.id, answers, endNow: quiz.stage === 'open' }, 'Failed to save the result');
      setEditingResult(false);
      setConfirmResult(false);
      setPreview(null);
      setMessage({ type: 'success', text: 'Result saved. The quiz is ready to settle.' });
      await refresh(quiz.id);
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Failed to save the result') });
    } finally {
      setBusy(false);
    }
  };

  const rewardsKey = JSON.stringify({ drafts, tieRule, pool });
  const previewFresh = preview !== null && preview.key === rewardsKey;

  const runPreview = async (quiz: SettlementQuiz) => {
    const parsed = toRewards(drafts);
    if ('error' in parsed) {
      setMessage({ type: 'error', text: parsed.error });
      return;
    }
    const share = quiz.pointsPool > 0 ? toPoolShare(pool, quiz.pointsPool) : { percent: 0, each: 0 };
    if ('error' in share) {
      setMessage({ type: 'error', text: share.error });
      return;
    }
    setBusy(true);
    setMessage(null);
    setConfirmSettle(false);
    try {
      // Reusing the seed keeps a random tie-break and the pool shares the same while the admin edits rewards
      const data = await postJson('/api/admin/quiz-settlement/preview',
        { quizId: quiz.id, rewards: parsed.rewards, tieRule, seed: preview?.result.seed, poolPercent: share.percent, poolEach: share.each },
        'Failed to preview the winners');
      setPreview({ result: data.result, rewards: parsed.rewards, poolPercent: share.percent, poolEach: share.each, key: rewardsKey });
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Failed to preview the winners') });
    } finally {
      setBusy(false);
    }
  };

  const settle = async (quiz: SettlementQuiz, fresh: { result: Preview; rewards: Reward[]; poolPercent: number; poolEach: number }) => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await postJson('/api/admin/quiz-settlement',
        { quizId: quiz.id, rewards: fresh.rewards, tieRule, seed: fresh.result.seed, poolPercent: fresh.poolPercent, poolEach: fresh.poolEach },
        'Failed to settle the quiz');
      setPreview(null);
      setConfirmSettle(false);
      const paid = data.result.winners.length;
      const poolPaid = data.result.pool?.paid ?? 0;
      setMessage({
        type: 'success',
        text: `Settled: ${paid} ${paid === 1 ? 'winner' : 'winners'} paid` +
          (poolPaid > 0 ? `, and ${fmt(poolPaid)} pool points shared among ${fmt(data.result.pool.recipients)} players` +
            (fresh.poolEach > 0 ? ` (${pointsEach(fresh.poolEach)})` : '') : '') +
          `. ${data.notified ? 'Players have been notified.' : 'Notifying players failed, but the rewards are paid.'}`,
      });
      await refresh(quiz.id);
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Failed to settle the quiz') });
    } finally {
      setBusy(false);
    }
  };

  // Notifying runs after the payout and can fail on its own; this reaches only the players not told yet
  const resendNotices = async (quiz: SettlementQuiz) => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await postJson('/api/admin/quiz-settlement/notify', { quizId: quiz.id }, 'Failed to send the notices');
      setMessage(data.notified
        ? { type: 'success', text: 'Notices sent to every player who did not have one yet.' }
        : { type: 'error', text: 'Sending the notices failed again. Try again in a few minutes.' });
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, 'Failed to send the notices') });
    } finally {
      setBusy(false);
    }
  };

  const visible = filter === 'all' ? quizzes : quizzes.filter((q) => q.stage === filter);
  const quiz = detail?.quiz;
  const allAnswered = !!detail && detail.questions.every((q) => answers[q.id] !== undefined);
  const showResultForm = !!quiz && (quiz.stage === 'awaiting_result' || (editingResult && (quiz.stage === 'open' || quiz.stage === 'ready_to_settle')));

  return (
    <div className="space-y-6">
      <nav aria-label="Filter quizzes by stage" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = f === 'all' ? quizzes.length : quizzes.filter((q) => q.stage === f).length;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${filter === f
                ? 'border-violet-400 bg-violet-500/20 text-white'
                : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}
            >
              {f === 'all' ? 'All' : STAGE_LABELS[f]} ({count})
            </button>
          );
        })}
      </nav>

      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border p-4 text-sm ${message.type === 'error'
            ? 'border-red-500/40 bg-red-900/30 text-red-200'
            : 'border-emerald-500/40 bg-emerald-900/30 text-emerald-200'}`}>
          {message.text}
        </div>
      )}

      <section aria-label="Quizzes" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loadingList && quizzes.length === 0 && <p className="text-gray-400">Loading quizzes…</p>}
        {!loadingList && visible.length === 0 && <p className="text-gray-400">No quizzes here.</p>}
        {visible.map((q) => (
          <button
            key={q.id}
            type="button"
            aria-pressed={q.id === selectedId}
            onClick={() => select(q.id)}
            className={`rounded-xl border p-4 text-left transition-colors ${q.id === selectedId
              ? 'border-violet-400 bg-violet-500/15'
              : 'border-white/10 bg-white/5 hover:border-white/25'}`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="font-semibold text-white">{q.title}</span>
              <StageBadge stage={q.stage} />
            </div>
            <p className="text-xs text-gray-400">
              {q.totalQuestions} {q.totalQuestions === 1 ? 'question' : 'questions'} · {entries(q)}
            </p>
          </button>
        ))}
      </section>

      {selectedId && loadingDetail && !detail && <p className="text-gray-400">Loading the quiz…</p>}

      {quiz && detail && (
        <section aria-label="Selected quiz" className="space-y-6 rounded-2xl border border-white/10 bg-gray-900/60 p-6">
          <header className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-white">{quiz.title}</h2>
              <StageBadge stage={quiz.stage} />
            </div>
            <p className="text-sm text-gray-400">
              {quiz.attempts} {quiz.attempts === 1 ? 'player' : 'players'} answered {quiz.totalQuestions} {quiz.totalQuestions === 1 ? 'question' : 'questions'}
              {quiz.closesAt ? ` · answering ${quiz.stage === 'open' ? 'closes' : 'closed'} ${pkTime(quiz.closesAt)}` : ''}
            </p>
            <p className="text-xs text-gray-500">
              Entries: {entries(quiz)}{quiz.pointsPool > 0 ? ` · points pool ${fmt(quiz.pointsPool)}` : ''} (only admins see these)
            </p>
          </header>

          {quiz.stage === 'upcoming' && (
            <p className="text-gray-300">This quiz hasn&apos;t started yet. You can settle it after it has run.</p>
          )}

          {quiz.stage === 'open' && !editingResult && (
            <div className="space-y-3">
              <p className="text-gray-300">
                {quiz.closesAt ? 'Players can still answer.' : 'Players can still answer: this quiz has no time limit.'}
              </p>
              <button type="button" onClick={() => setEditingResult(true)}
                className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/20">
                End quiz now and enter the result
              </button>
            </div>
          )}

          {showResultForm && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">Result</h3>
              <p className="text-sm text-gray-400">Choose what actually happened: the correct option for every question.</p>
              <ResultForm questions={detail.questions} answers={answers} disabled={busy}
                onPick={(id, option) => { setAnswers((prev) => ({ ...prev, [id]: option })); setConfirmResult(false); }} />
              {!confirmResult ? (
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={!allAnswered || busy} onClick={() => setConfirmResult(true)}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                    Save result
                  </button>
                  {editingResult && (
                    <button type="button" onClick={() => { setEditingResult(false); setConfirmResult(false); }}
                      className="rounded-xl border border-white/10 px-5 py-2.5 text-gray-300">
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div role="alertdialog" aria-label="Confirm result" className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-900/20 p-4">
                  <p className="text-sm text-amber-100">
                    {quiz.stage === 'open'
                      ? 'This ends the quiz now: players can no longer answer once the result is saved.'
                      : 'Players can no longer answer these questions once the result is saved.'}
                  </p>
                  <div className="flex gap-3">
                    <button type="button" disabled={busy} onClick={() => saveResult(quiz)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                      {busy ? 'Saving…' : 'Yes, save the result'}
                    </button>
                    <button type="button" onClick={() => setConfirmResult(false)} className="rounded-xl border border-white/10 px-4 py-2 text-gray-300">
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {quiz.stage === 'ready_to_settle' && !editingResult && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Result</h3>
                  <button type="button" onClick={() => setEditingResult(true)} className="text-sm text-sky-300 hover:underline">Edit result</button>
                </div>
                <ul className="space-y-1 text-sm">
                  {detail.questions.map((q) => (
                    <li key={q.id} className="text-gray-300">
                      {q.text} <span className="font-semibold text-emerald-300">→ {q.options[q.correctOption as number]}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-white">Rewards</h3>
                <RewardsEditor drafts={drafts} prizes={prizes} tieRule={tieRule} disabled={busy}
                  onChange={(i, d) => setDrafts((prev) => prev.map((old, j) => (j === i ? d : old)))}
                  onTieRule={setTieRule} />
                <PoolEditor pointsPool={quiz.pointsPool} entrants={Math.min(quiz.attempts, quiz.maxEntries)} draft={pool} onChange={setPool} disabled={busy} />
                <button type="button" disabled={busy} onClick={() => runPreview(quiz)}
                  className="rounded-xl bg-sky-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                  {busy && !previewFresh ? 'Working…' : 'Preview winners'}
                </button>
                {preview && !previewFresh && (
                  <p className="text-sm text-amber-300">The rewards changed since this preview. Preview again before settling.</p>
                )}
              </div>

              {preview && previewFresh && (
                <div className="space-y-4 rounded-xl border border-sky-500/30 bg-sky-900/10 p-4">
                  <h3 className="font-semibold text-white">Preview: {preview.result.participants} {preview.result.participants === 1 ? 'player' : 'players'}</h3>
                  <WinnersTable winners={preview.result.winners} unfilled={preview.result.unfilled} />
                  {poolLine(preview.result) && <p className="text-sm text-emerald-200">{poolLine(preview.result)}</p>}
                  {!confirmSettle ? (
                    <button type="button" disabled={busy} onClick={() => setConfirmSettle(true)}
                      className="rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
                      Settle quiz
                    </button>
                  ) : (
                    <div role="alertdialog" aria-label="Confirm settlement" className="space-y-3 rounded-xl border border-pink-500/40 bg-pink-900/20 p-4">
                      <p className="text-sm text-pink-100">
                        Pay these rewards now and notify the players? This can&apos;t be undone, and the quiz can&apos;t be settled again.
                      </p>
                      <div className="flex gap-3">
                        <button type="button" disabled={busy} onClick={() => settle(quiz, preview)}
                          className="rounded-xl bg-pink-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                          {busy ? 'Settling…' : 'Yes, settle now'}
                        </button>
                        <button type="button" onClick={() => setConfirmSettle(false)} className="rounded-xl border border-white/10 px-4 py-2 text-gray-300">
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {quiz.stage === 'settled' && detail.settlement && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                Settled {pkTime(detail.settlement.settledAt)} by {detail.settlement.settledBy} · ties: {TIE_RULES[detail.settlement.tieRule] ?? detail.settlement.tieRule}
              </p>
              <WinnersTable winners={detail.settlement.winners} />
              {detail.settlement.pool.percent > 0 && (
                <p className="text-sm text-gray-300">
                  Points pool (first {detail.settlement.pool.percent}% of entrants): {fmt(detail.settlement.pool.points)} points{' '}
                  {detail.settlement.pool.each > 0
                    ? `paid ${pointsEach(detail.settlement.pool.each)} to ${fmt(detail.settlement.pool.recipients)} players.`
                    : `shared at random among ${fmt(detail.settlement.pool.recipients)} players.`}
                </p>
              )}
              {detail.settlement.seed && (
                <p className="break-all font-mono text-xs text-gray-500">Draw seed: {detail.settlement.seed}</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy} onClick={() => resendNotices(quiz)}
                  className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-50">
                  Send notices again
                </button>
                <span className="text-xs text-gray-500">Only players who did not get theirs are sent one.</span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
