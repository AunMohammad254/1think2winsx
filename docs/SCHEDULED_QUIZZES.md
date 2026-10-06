# Scheduled quizzes

How a quiz goes from "scheduled" to live, and what keeps it on time.

## Admin workflow

1. **Schedule.** Create or edit a quiz, set status **Scheduled**, pick the date and time. The date is required.
   The quiz is hidden from users and stays `scheduled`.
2. **Notify (optional).** Quiz menu (⋮) → **Notify users: upcoming quiz**. This only sends a notification
   ("…goes live Dec 1, 2026, 4:30 PM PKT"). It does **not** change the quiz. If users were already notified,
   you are asked to confirm before sending again.
3. **Go live (automatic).** At the scheduled time the quiz becomes `active`, everyone gets a "Live now"
   notification, and the quiz can be attempted.
4. **Close (automatic).** `duration` minutes after it went live the quiz is paused. It stays listed as
   "Time-up" for `timeUpDuration` minutes.

An automatic "starts in 10 minutes" reminder is also sent once per scheduled quiz.

## What makes it happen

Go-live does not depend on any external scheduler:

| Mechanism | Where | Notes |
|---|---|---|
| Read-time check | `lib/quiz-catalog.ts` | The first quiz-list/open request after `startsAt` activates the quiz. |
| In-process loop | `instrumentation.ts` → `lib/scheduler-loop.ts` | Runs all jobs every 60 s on a Node host (Hostinger). On by default in production, off on Vercel and in `next dev`. |
| HTTP endpoint | `GET /api/cron/process-scheduled` | Manual trigger / Vercel cron / external scheduler. Needs `CRON_SECRET`. |

All three run the same code (`lib/scheduled-jobs.ts`). Every step claims its rows with a conditional
update first, so running several at once (or on several servers) never double-activates a quiz or
double-sends a notification.

The jobs: activate due quizzes, 10-minute reminders, pause quizzes whose window is over, send admin-scheduled
notifications, reject wallet deposits pending for 48 h.

Optional: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/process-scheduled`
runs everything immediately and returns what it processed.

## Answering window

A quiz accepts answers from the moment it goes live until `duration` minutes after `pushedAt` (plus 30 s
grace for network latency). This is enforced inside the database function `submit_quiz_attempt`
(migration `SQL/supabase/migrations/20261006120000_quiz_submit_answering_window.sql`), so it holds even if
the scheduler is late or someone calls the API directly. A quiz that was never pushed has no window.

Note: **Publish** on an old quiz does not restart its window; use **Push to live viewers** to start a new one.

## Time zones

- The admin picks a time in their own browser's timezone; it is stored as an exact UTC instant.
- Anything sent without a zone is read as **business time**, never the server's timezone.
  Business time is `Asia/Karachi` by default; set `NEXT_PUBLIC_APP_TIME_ZONE` (any IANA name) to change it.
  It is also the zone shown in notification text.
- Users and admins see times in their own timezone on screen.

Code: `src/lib/schedule-time.ts`. Never use `new Date("<zone-less string>")` for a schedule time.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_TIME_ZONE` | `Asia/Karachi` | Business timezone (see above). Set before building (it is a `NEXT_PUBLIC_` variable). |
| `SCHEDULER_ENABLED` | on in production (not Vercel) | `true`/`false` to force the in-process loop on or off. |
| `CRON_SECRET` | – | Protects `/api/cron/process-scheduled`. |

## Troubleshooting

- **Quiz shows the wrong time:** it was saved by a build from before the time fix. Re-save it.
- **Quiz didn't go live:** open the quiz list once (that alone triggers go-live), or call the endpoint above.
  Check the quiz has a start date and status `scheduled`.
- **Production logs are empty:** `next.config.js` strips `console.*` in production builds, so the scheduler
  logs nothing there. Check the database (`Quiz.status`, `Quiz.pushedAt`) instead.
