/**
 * Post-deploy smoke check: run it after every Hostinger deploy.
 *
 *   bun run smoke:prod                                         # https://1think2win.com
 *   bun load-test/smoke.ts --base https://staging.example.com  # or SMOKE_BASE_URL=...
 *
 * About ten sequential requests, no sign-in, no writes, no secrets: the home page is the app (not a
 * parked-domain page), /api/live and the shared quiz copy are cached by Cloudflare with the right
 * headers and no answer key, a query string on /api/live is blocked by the WAF, /api/health answers,
 * and www redirects to the apex. Prints one line per check and exits 1 listing every failure
 * (2 for bad options). The checks themselves are in lib/smoke-checks.ts.
 */
import { formatResult, parseSmokeArgs, runSmoke, summarize, USAGE } from './lib/smoke-checks';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  let options;
  try {
    options = parseSmokeArgs(argv, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
    return;
  }

  console.log(`Smoke check of ${options.baseUrl} (${new Date().toISOString()})\n`);
  const results = await runSmoke(options, fetch, (result) => console.log(formatResult(result)));
  const { failed, text } = summarize(results);
  console.log(`\n${text}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
