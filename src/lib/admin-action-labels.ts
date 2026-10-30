/**
 * What the admin action log records (lib/admin-action-log.ts), as the History tab names it. No server
 * imports: the admin quiz page's client component reads these too.
 */

export const QUIZ_ACTION_LABELS = {
  quiz_created: 'Created the quiz',
  quiz_edited: 'Edited the quiz',
  quiz_status_changed: 'Changed the status',
  quiz_published: 'Published',
  quiz_paused: 'Paused',
  quiz_pushed_live: 'Pushed live',
  quiz_scheduled: 'Scheduled',
  quiz_announced: 'Announced as upcoming',
  quiz_deleted: 'Deleted the quiz',
  question_added: 'Added a question',
  question_edited: 'Edited a question',
  question_deleted: 'Deleted a question',
  result_saved: 'Saved the result',
  quiz_settled: 'Settled the quiz',
  notices_resent: 'Sent the notices again',
  // Match mode (src/lib/match-service.ts). Balls aren't logged here: each "BallEvent" keeps who recorded it.
  match_created: 'Created the match',
  match_innings_started: 'Started an innings',
  match_innings_ended: 'Ended an innings by hand',
  match_ball_undone: 'Undid a ball',
  match_answers_closed: 'Closed the open questions',
  match_abandoned: 'Abandoned the match',
  match_ball_corrected: 'Corrected a ball',
  match_innings_resumed: 'Resumed an innings ended by hand',
  match_innings_removed: 'Removed an innings with no balls',
  match_answers_reopened: 'Reopened answers closed early',
  match_restored: 'Restored the abandoned match',
  match_questions_sent: "Sent an over's questions to players",
  match_questions_skipped: "Skipped an over's questions",
  match_auto_send_changed: 'Switched automatic sending of questions',
  match_published: 'Took the match live for players',
  match_hidden: 'Hid the match from players',
  match_entry_limit_changed: 'Changed how many players can join',
} as const;

export type QuizAction = keyof typeof QUIZ_ACTION_LABELS;

export interface QuizActionEntry {
  id: string;
  quizId: string | null;
  quizTitle: string | null;
  action: QuizAction;
  adminEmail: string;
  details: Record<string, unknown>;
  createdAt: string;
}
