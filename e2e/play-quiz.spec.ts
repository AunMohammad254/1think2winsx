import { test, expect, type Page } from '@playwright/test';
import { ADMIN, closeDb, createLiveQuiz, createPlayer, db, readStackEnv } from './stack/fixtures';

/**
 * G7 from the quiz deep dive: a real browser plays a live quiz against a real database, Auth and API,
 * and the admin saves the result and settles it. Runs only against the local Supabase stack (see
 * e2e/README.md: `bun run test:e2e:quiz`); the regular e2e run skips it.
 */
test.skip(!readStackEnv(), 'Needs the local Supabase stack: node e2e/stack/stack.mjs up (see e2e/README.md)');
test.describe.configure({ mode: 'serial' });
test.afterAll(closeDb);

const QUESTIONS = [
  { text: 'Who wins the toss?', options: ['Pakistan', 'India'] },
  { text: 'Who is the top scorer?', options: ['Babar Azam', 'Virat Kohli'] },
];

async function signIn(page: Page, player: { email: string; password: string }) {
  await page.goto('/auth?mode=login');
  await page.locator('#login-email').fill(player.email);
  await page.locator('#login-password').fill(player.password);
  // Sign In waits for the CAPTCHA token (Cloudflare's always-pass test key here)
  const signInButton = page.locator('form').getByRole('button', { name: 'Sign In', exact: true });
  await expect(signInButton).toBeEnabled({ timeout: 30_000 });
  await signInButton.click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30_000 });
}

/** The live quiz popup on /quizzes, through the link the "quiz is live" notification carries. */
async function openLiveQuiz(page: Page, quiz: { id: string }, title: string) {
  await page.goto(`/quizzes?openQuiz=${quiz.id}`);
  const panel = page.getByRole('region', { name: title });
  await expect(panel.getByText(QUESTIONS[0].text, { exact: false })).toBeVisible({ timeout: 30_000 });
  return panel;
}

const answersOf = async (userId: string, quizId: string) =>
  (await db().query(`SELECT "questionId", "selectedOption" FROM "QuestionAttempt" WHERE "userId" = $1 AND "quizId" = $2 ORDER BY "questionId"`, [userId, quizId])).rows;

test('a player answers a live quiz, the admin saves the result and settles, and the player sees the outcome', async ({ page, browser }) => {
  const title = `E2E final ${Date.now()}`;
  const quiz = await createLiveQuiz({ title, durationMinutes: 10, pushedSecondsAgo: 5, questions: QUESTIONS });
  const player = await createPlayer('E2E Player');

  // The player locks in Pakistan and Virat Kohli
  await signIn(page, player);
  const panel = await openLiveQuiz(page, quiz, title);
  await panel.getByText('Pakistan', { exact: true }).click();
  await panel.getByText('Virat Kohli', { exact: true }).click();
  await panel.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(panel.getByText('Answer locked in — waiting for results')).toBeVisible();
  expect(await answersOf(player.id, quiz.id)).toEqual([
    { questionId: quiz.questionIds[0], selectedOption: 0 },
    { questionId: quiz.questionIds[1], selectedOption: 1 },
  ]);

  // The admin ends the quiz with the result (Pakistan, Babar Azam), then pays 1st place 500 points
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/admin/login');
  await admin.locator('#email').fill(ADMIN.email);
  await admin.locator('#password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Access Admin Panel' }).click();
  await admin.waitForURL(/\/admin\/dashboard/, { timeout: 30_000 });

  await admin.goto('/admin/quiz-evaluation');
  await admin.getByRole('region', { name: 'Quizzes' }).getByRole('button', { name: new RegExp(title) }).click({ timeout: 30_000 });
  const selected = admin.getByRole('region', { name: 'Selected quiz' });
  await selected.getByRole('button', { name: 'End quiz now and enter the result' }).click();
  await selected.getByRole('radiogroup', { name: `Correct answer for: ${QUESTIONS[0].text}` }).getByRole('radio', { name: 'Pakistan' }).click();
  await selected.getByRole('radiogroup', { name: `Correct answer for: ${QUESTIONS[1].text}` }).getByRole('radio', { name: 'Babar Azam' }).click();
  await selected.getByRole('button', { name: 'Save result' }).click();
  await selected.getByRole('alertdialog', { name: 'Confirm result' }).getByRole('button', { name: 'Yes, save the result' }).click();

  await selected.getByLabel('1st place reward type').selectOption('points', { timeout: 30_000 });
  await selected.getByLabel('1st place points').fill('500');
  await selected.getByRole('button', { name: 'Preview winners' }).click();
  await expect(selected.getByRole('heading', { name: 'Preview: 1 player' })).toBeVisible({ timeout: 30_000 });
  await selected.getByRole('button', { name: 'Settle quiz' }).click();
  await selected.getByRole('alertdialog', { name: 'Confirm settlement' }).getByRole('button', { name: 'Yes, settle now' }).click();
  await expect(selected.getByText(new RegExp(`Settled .* by ${ADMIN.email}`))).toBeVisible({ timeout: 30_000 });

  // One of two right: 50%, first place, 500 points, and the admin's actions are on record
  const { rows: [attempt] } = await db().query(
    `SELECT score, "correctAnswers", points, "isEvaluated" FROM "QuizAttempt" WHERE "userId" = $1 AND "quizId" = $2`, [player.id, quiz.id],
  );
  expect(attempt).toEqual({ score: 50, correctAnswers: 1, points: 500, isEvaluated: true });
  expect((await db().query(`SELECT points FROM "User" WHERE id = $1`, [player.id])).rows[0].points).toBe(500);
  const { rows: log } = await db().query(`SELECT action, "adminEmail" FROM "AdminActionLog" WHERE "quizId" = $1 ORDER BY "createdAt"`, [quiz.id]);
  expect(log).toEqual([
    { action: 'result_saved', adminEmail: ADMIN.email },
    { action: 'quiz_settled', adminEmail: ADMIN.email },
  ]);

  // The player's results page: 1 of 2, counted out of every question of the quiz
  await page.goto(`/quiz/${quiz.id}/results`);
  await expect(page.getByText('1/2')).toBeVisible({ timeout: 30_000 });
});

test("when time runs out, the player's answers so far are locked in", async ({ page }) => {
  // About half a minute left: enough to sign in and answer one of the two questions
  const title = `E2E time-out ${Date.now()}`;
  const quiz = await createLiveQuiz({ title, durationMinutes: 1, pushedSecondsAgo: 25, questions: QUESTIONS });
  const player = await createPlayer('E2E Late Player');

  // What the server said to each submit, for the report when the lock-in is missing
  const submits: string[] = [];
  page.on('response', async (r) => {
    if (r.url().endsWith('/submit')) submits.push(`${new Date().toISOString()} ${r.status()} ${await r.text().catch(() => '')}`);
  });
  await signIn(page, player);
  const panel = await openLiveQuiz(page, quiz, title);
  await panel.getByText('India', { exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Answer all 2 questions' })).toBeDisabled();

  // At the deadline the answered question is locked in on its own (within the 15 s spread);
  // before the G1 fix nothing was saved unless every question was answered. The scheduler must not
  // close the quiz before the 30 s grace period is over: it used to, and refused those lock-ins.
  await expect(panel.getByText("Time's up")).toBeVisible({ timeout: 60_000 });
  try {
    await expect.poll(() => answersOf(player.id, quiz.id), { timeout: 45_000 }).toEqual([
      { questionId: quiz.questionIds[0], selectedOption: 1 },
    ]);
  } finally {
    await test.info().attach('submit responses', { body: submits.join('\n') || '(none)', contentType: 'text/plain' });
  }
});
