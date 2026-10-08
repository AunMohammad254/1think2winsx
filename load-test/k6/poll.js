// Steady-state polling: every online player refreshing the quiz list.
//
//   k6 run -e BASE_URL=https://staging.example.com -e RATE=833 -e DURATION=5m load-test/k6/poll.js
//
// 50,000 players polling every 60 s is ~833 requests/s. The app's per-user limit is 60 requests/min,
// so RATE / (number of sessions) must stay below 1/s per user or you will measure the rate limiter.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { BASE_URL, sessionFor, jsonHeaders, record, summaryTo } from './lib.js';

export const options = {
  scenarios: {
    poll: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 833),
      timeUnit: '1s',
      duration: __ENV.DURATION || '5m',
      preAllocatedVUs: Number(__ENV.VUS || 300),
      maxVUs: Number(__ENV.MAX_VUS || 5000),
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    hard_errors: ['count==0'],
  },
};

export default function () {
  const { cookie } = sessionFor(exec.scenario.iterationInTest);
  const res = http.get(`${BASE_URL}/api/quizzes?fresh=1`, {
    headers: jsonHeaders(cookie),
    tags: { name: 'GET /api/quizzes' },
  });
  const ok = record(res, [200, 304]);
  check(res, { 'quiz list ok': () => ok });
}

export function handleSummary(data) {
  return summaryTo('poll', data);
}
