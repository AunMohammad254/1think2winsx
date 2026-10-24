# End-to-end tests

`bun run test:e2e` runs the page checks in this folder against `bun run build && bun run start`
(see `playwright.config.ts`). They need no database.

## The quiz test (`play-quiz.spec.ts`)

G7 from the quiz deep dive: a real browser plays a live quiz against a real database, Auth server
and API. Then the admin saves the result and settles it. The test checks:

- the player's answers are stored;
- the score, correct answers and points come out right;
- the admin's actions are recorded;
- the player's results page counts every question;
- when time runs out, the answers given so far are locked in (the G1 fix).

It runs against a **local Supabase stack in Docker**, never against a hosted project:

```bash
node e2e/stack/stack.mjs up
```

```bash
git worktree add --detach ../t2w-e2e-app HEAD
```

```bash
cd ../t2w-e2e-app && bun install --frozen-lockfile
```

```bash
E2E_APP_DIR=../t2w-e2e-app bun run test:e2e:quiz
```

```bash
node e2e/stack/stack.mjs down
```

### What each step does

- **`node e2e/stack/stack.mjs up`**
  - Starts Postgres, Auth, the REST API and its gateway with Supabase CLI 2.119.0. Everything else is excluded. The ports are 55321 (API) and 55322 (database).
  - Builds the schema from `db-tests/schema` (production's baseline plus every migration since), without the plain-Postgres shim.
  - Adds production's `on_auth_user_created` trigger and turns the wallet off.
  - Writes the stack's URL and keys to `e2e/stack/.env.e2e` (gitignored).
- **A clean worktree for the app.** The app under test loads every `.env` file in its folder, and this checkout's files hold the live project's keys. `playwright.stack.config.ts` therefore refuses to start the app in a folder that has one. Point `E2E_APP_DIR` at a clean worktree, such as the one above. Its `HEAD` is the code under test.
- **`bun run test:e2e:quiz`**
  - Builds and starts the app on port 3100.
  - Gives the app only the stack's keys, an admin login of `admin@e2e.test` / `e2e-admin-password`, Cloudflare's always-pass Turnstile test key and the wallet off. No email or push keys are set, so nothing is sent.
  - Players and quizzes are created by the test itself (`e2e/stack/fixtures.ts`).
- **`down`** stops the stack and deletes its data.

The regular e2e run ignores this test (`testIgnore` in `playwright.config.ts`). The test also skips itself when `e2e/stack/.env.e2e` is missing.
