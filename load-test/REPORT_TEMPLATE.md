# Load-test report

Copy this file to `load-test/.data/REPORT.md` and fill it in. Write numbers, not impressions. If you
didn't do something, write "skipped" and why.

Date: ____  Tester: ____  Code version tested (commit id): ____

## Part A — Environment facts (owner checklist)

| Item | Answer |
|---|---|
| Supabase organization plan | |
| Production DB compute size | |
| Staging DB compute size (should equal production) | |
| PostgREST *Max rows* | |
| JWT signing key type (ES256?) — production / staging | |
| Auth rate limits (sign-in / sign-up / token refresh) — original values | |
| Realtime max concurrent connections / max events per second | |
| Custom SMTP configured? | |
| Hostinger plan name / CPU / RAM | |
| Hostinger datacenter location | |
| Hostinger CDN / caching toggle (present? on?) | |
| `WALLET_FEATURE_ENABLED` in hPanel | |
| Brevo send limit (per day / month) | |
| Visitor-IP result: what `client.received` showed (paste) | |
| Visitor-IP setting chosen (`TRUSTED_PROXY_HOPS` / `TRUSTED_IP_HEADER`) and confirmed `resolvedIp`? | |
| Test machine (CPU / RAM / wired?) | |
| Staging users seeded / sessions created | |

## Part B — Results per run (from the k6 summary)

Fill one row per run. "Peak loop lag" and "Peak RSS" come from the monitor window.

| # | Scenario | Target rate | Achieved req/s | p50 ms | p95 ms | p99 ms | http failures % | shed 503 | hard errors | Peak loop lag (ms) | Peak RSS (MB) | Stopped early? why |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | poll | 100 | | | | | | | | | | |
| 2 | poll | 400 | | | | | | | | | | |
| 3 | poll | 833 | | | | | | | | | | |
| 4 | public | 500 | | | | | | | | | | |
| 5 | public | 1500 | | | | | | | | | | |
| H1 | herd open | ~500 | | | | | | | | | | |
| H1 | herd submit | ~500 | | | | | | | | | | |
| H2 | herd open | ~1670 | | | | | | | | | | |
| H2 | herd submit | ~1670 | | | | | | | | | | |

Extra runs (the rate where it broke, if you found it): ____

## Part C — Database (staging) after each run

Paste the `pg_stat_statements` top-10 table from the run that hurt most. Then:

| Run | DB CPU peak % | Connections peak (of 60) | Notes |
|---|---|---|---|
| | | | |

## Part D — Hostinger

| Run | CPU peak (graph) | RAM peak (graph) | Any 503 / resource-limit warning / restart? |
|---|---|---|---|
| | | | |

Did the **production** site slow down during any run? (yes/no, which run)

## Part E — Anything strange
Errors you saw, firewall blocks, runs that behaved differently from the others, things you changed
mid-test:

## Part F — Your read (optional)
In your own words: at what point did it start to feel slow or fail?
