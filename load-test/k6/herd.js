// Go-live herd: everyone opens the quiz, then everyone submits.
//
//   1. In the STAGING admin, create an ACTIVE quiz and note its id.
//   2. k6 run -e BASE_URL=... -e QUIZ_ID=<id> -e OPEN_SECONDS=30 -e SUBMIT_SECONDS=30 \
//             load-test/k6/herd.js
//
// Phase "open":   GET /api/quizzes/<id> for every session, spread evenly over OPEN_SECONDS.
// Phase "submit": POST /api/quizzes/<id>/submit once per session over SUBMIT_SECONDS.
//
// Each session can submit ONCE per quiz (database-enforced), so use a fresh quiz (or fresh users)
// for every run. 50,000 submits in 30 s is ~1,700 req/s; in 10 s it is 5,000 req/s.
import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { BASE_URL, sessions, sessionFor, jsonHeaders, randomCsrfToken, record, summaryTo } from './lib.js';

const QUIZ_ID = __ENV.QUIZ_ID;
if (!QUIZ_ID) throw new Error('Set QUIZ_ID to an active quiz on the staging project');

const OPEN_SECONDS = Number(__ENV.OPEN_SECONDS || 30);
const SUBMIT_SECONDS = Number(__ENV.SUBMIT_SECONDS || 30);
const GAP_SECONDS = Number(__ENV.GAP_SECONDS || 10); // players read the questions before submitting
const total = sessions.length;

export const options = {
  scenarios: {
    open: {
      executor: 'constant-arrival-rate',
      exec: 'openQuiz',
      rate: Math.max(1, Math.ceil(total / OPEN_SECONDS)),
      timeUnit: '1s',
      duration: `${OPEN_SECONDS}s`,
      preAllocatedVUs: Number(__ENV.VUS || 500),
      maxVUs: Number(__ENV.MAX_VUS || 8000),
    },
    submit: {
      executor: 'constant-arrival-rate',
      exec: 'submitQuiz',
      startTime: `${OPEN_SECONDS + GAP_SECONDS}s`,
      rate: Math.max(1, Math.ceil(total / SUBMIT_SECONDS)),
      timeUnit: '1s',
      duration: `${SUBMIT_SECONDS}s`,
      preAllocatedVUs: Number(__ENV.VUS || 500),
      maxVUs: Number(__ENV.MAX_VUS || 8000),
    },
  },
  thresholds: {
    'http_req_duration{name:open}': ['p(95)<2000'],
    'http_req_duration{name:submit}': ['p(95)<3000'],
    hard_errors: ['count==0'],
  },
};

// Question ids/option counts come from one real open of the quiz
export function setup() {
  const res = http.get(`${BASE_URL}/api/quizzes/${QUIZ_ID}`, { headers: jsonHeaders(sessionFor(0).cookie) });
  if (res.status !== 200) fail(`Cannot open quiz ${QUIZ_ID}: HTTP ${res.status} ${res.body}`);
  const quiz = res.json('quiz');
  return { questions: quiz.questions.map((q) => ({ id: q.id, options: q.options.length })) };
}

export function openQuiz() {
  const i = exec.scenario.iterationInTest;
  if (i >= total) return;
  const res = http.get(`${BASE_URL}/api/quizzes/${QUIZ_ID}`, {
    headers: jsonHeaders(sessionFor(i).cookie),
    tags: { name: 'open' },
  });
  const ok = record(res, [200, 403]); // 403 = already completed in an earlier run
  check(res, { 'quiz opened': () => ok });
}

export function submitQuiz(data) {
  const i = exec.scenario.iterationInTest;
  if (i >= total) return;
  const answers = data.questions.map((q) => ({
    questionId: q.id,
    selectedOption: Math.floor(Math.random() * q.options),
  }));
  const res = http.post(`${BASE_URL}/api/quizzes/${QUIZ_ID}/submit`, JSON.stringify({ answers }), {
    headers: jsonHeaders(sessionFor(i).cookie, {
      'Content-Type': 'application/json',
      'X-CSRF-Token': randomCsrfToken(),
      // The app's CSRF check compares Origin to Host, as a browser would send it
      Origin: BASE_URL,
    }),
    tags: { name: 'submit' },
  });
  // 200 = accepted. 403 with "closed"/"already" are also legitimate outcomes of a re-run.
  const ok = record(res, [200, 403]);
  check(res, { 'submit accepted': () => ok });
}

export function handleSummary(data) {
  return summaryTo('herd', data);
}
