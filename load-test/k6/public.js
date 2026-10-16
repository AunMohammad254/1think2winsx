// Anonymous traffic: the leaderboard, the live-stream check every quiz page makes, and the health probe.
// No sessions needed.
//
//   k6 run -e BASE_URL=https://staging.example.com -e RATE=1500 -e DURATION=3m load-test/k6/public.js
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, record, summaryTo } from './lib.js';

export const options = {
  scenarios: {
    public: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 1000),
      timeUnit: '1s',
      duration: __ENV.DURATION || '3m',
      preAllocatedVUs: Number(__ENV.VUS || 200),
      maxVUs: Number(__ENV.MAX_VUS || 4000),
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    hard_errors: ['count==0'],
  },
};

export default function () {
  // Rough mix of what an online player's browser asks for
  const roll = Math.random();
  let res;
  if (roll < 0.6) {
    res = http.get(`${BASE_URL}/api/streaming/active`, { tags: { name: 'streaming-active' } });
  } else if (roll < 0.9) {
    res = http.get(`${BASE_URL}/api/leaderboard?limit=10&timeframe=allTime`, { tags: { name: 'leaderboard' } });
  } else {
    res = http.get(`${BASE_URL}/api/health`, { tags: { name: 'health' } });
  }
  const ok = record(res, [200]);
  check(res, { 'public ok': () => ok });
}

export function handleSummary(data) {
  return summaryTo('public', data);
}
