import { ANON, userToken, userId } from './keys.mjs';
const B = process.env.B || 'http://127.0.0.1:3001';
const me = userId(7), other = userId(8), T = userToken(7);
const h = { apikey: ANON, Authorization: `Bearer ${T}`, 'content-type': 'application/json', Prefer: 'return=representation' };
async function t(name, url, opt = {}) {
  const r = await fetch(B + url, { headers: h, ...opt }); const body = (await r.text()).slice(0, 160);
  console.log(`${name.padEnd(44)} -> ${r.status} ${body}`);
}
await t('Set own walletBalance=99999', `/User?id=eq.${me}`, { method: 'PATCH', body: JSON.stringify({ walletBalance: 99999, points: 99999 }) });
await t('Read all users emails (count)', `/User?select=email&limit=5`);
await t('Read other user row', `/User?id=eq.${other}&select=email,phone`);
await t('Read Question.correctOption', `/Question?select=id,correctOption&limit=2`);
await t('Read Question (allowed cols)', `/Question?select=id,text&limit=1`);
await t('Insert free DailyPayment', `/DailyPayment`, { method: 'POST', body: JSON.stringify({ id: 'hack1', userId: me, amount: 0, status: 'completed', expiresAt: '2030-01-01', updatedAt: '2026-01-01' }) });
await t('Insert approved WalletTransaction', `/WalletTransaction`, { method: 'POST', body: JSON.stringify({ id: 'hack2', userId: me, amount: 5000, paymentMethod: 'x', transactionId: 'hack2', status: 'approved', updatedAt: '2026-01-01' }) });
await t('Set own QuizAttempt score=100', `/QuizAttempt?userId=eq.${me}`, { method: 'PATCH', body: JSON.stringify({ score: 100, isEvaluated: true }) });
await t('Set own Answer isCorrect=true', `/Answer?userId=eq.${me}`, { method: 'PATCH', body: JSON.stringify({ isCorrect: true }) });
await t('Read RateLimitEntry', `/RateLimitEntry?limit=1`);
await t('RPC submit as OTHER user', `/rpc/submit_quiz_attempt`, { method: 'POST', body: JSON.stringify({ p_user_id: other, p_quiz_id: 'quiz1', p_answers: [{ questionId: 'q1_1', selectedOption: 1 }] }) });
await t('RPC submit: change old prediction', `/rpc/submit_quiz_attempt`, { method: 'POST', body: JSON.stringify({ p_user_id: me, p_quiz_id: 'quiz1', p_answers: [{ questionId: 'q1_1', selectedOption: 3 }] }) });
await t('RPC submit: foreign question id', `/rpc/submit_quiz_attempt`, { method: 'POST', body: JSON.stringify({ p_user_id: me, p_quiz_id: 'quiz1', p_answers: [{ questionId: 'q2_1', selectedOption: 1 }] }) });
await t('RPC submit: inactive quiz', `/rpc/submit_quiz_attempt`, { method: 'POST', body: JSON.stringify({ p_user_id: me, p_quiz_id: 'quiz7', p_answers: [{ questionId: 'q7_1', selectedOption: 1 }] }) });
await t('RPC pay_quiz_access (already paid)', `/rpc/pay_quiz_access`, { method: 'POST', body: '{}' });
await t('RPC evaluate_quiz as user', `/rpc/evaluate_quiz`, { method: 'POST', body: JSON.stringify({ p_quiz_id: 'quiz1', p_correct_answers: {} }) });
await t('RPC get_leaderboard as user', `/rpc/get_leaderboard`, { method: 'POST', body: '{}' });
