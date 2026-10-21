/**
 * Cloudflare page cache: check it, or purge it after a deploy (deploy/CLOUDFLARE_PAGE_CACHE.md).
 *
 *   bun run cache:check     # are the public pages served from Cloudflare's cache, current, and nothing personal?
 *   bun run cache:purge     # after every Hostinger deploy: Purge Everything, then the same checks
 *
 * Cloudflare keeps the public pages for a year, so a deploy is not visible until the cache is purged, and
 * until then the old pages point at JS chunks the new build deleted. The purge refuses to run while
 * Cloudflare already serves the build the origin runs (the deploy is not live yet); --force overrides.
 * Prints one line per check and exits 1 listing every failure (2 for bad options or missing credentials).
 * The checks themselves are in lib/page-cache-checks.ts.
 */
import { formatResult, summarize } from './lib/smoke-checks';
import {
  cloudflareCredentials, decidePurge, parsePageCacheArgs, purgeEverything, readBuilds, runPageCacheChecks, USAGE,
} from './lib/page-cache-checks';

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  let options;
  let credentials;
  try {
    options = parsePageCacheArgs(argv, process.env);
    if (options.purge) credentials = cloudflareCredentials(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
    return;
  }

  if (credentials) {
    const { origin, edge } = await readBuilds(options);
    const decision = decidePurge(origin, edge, options.force);
    console.log(`${decision.purge ? 'Purging' : 'Not purging'}: ${decision.reason}`);
    if (!decision.purge) {
      process.exitCode = 1;
      return;
    }
    try {
      await purgeEverything(credentials, fetch, options.timeoutMs);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      return;
    }
    console.log('Purged everything on the zone.\n');
  }

  console.log(`Page cache check of ${options.baseUrl} (${new Date().toISOString()})\n`);
  const results = await runPageCacheChecks(options, fetch, (result) => console.log(formatResult(result)));
  const { failed, text } = summarize(results);
  console.log(`\n${text}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
