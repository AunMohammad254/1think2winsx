// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { isUncacheableRoute, linkPrefetch } from '@/lib/link-prefetch';

describe('isUncacheableRoute', () => {
  it.each([
    '/quizzes', '/quizzes?openQuiz=q1', '/quizzes#schedule', '/quiz/q1', '/quiz/q1/results',
    '/profile', '/profile/wallet', '/profile/edit', '/login', '/login?redirect=%2Fquizzes', '/register',
    '/auth', '/auth?mode=login', '/auth/clear',
  ])('%s never comes from the Cloudflare cache', (href) => {
    expect(isUncacheableRoute(href)).toBe(true);
  });

  it.each(['/', '/prizes', '/leaderboard', '/how-to-play', '/faq', '/contact', '/terms', '/privacy', '/disclaimer', '/quizzes-archive', '/authors', '#how', 'https://example.com/quizzes'])(
    '%s is not a personal page or a redirect',
    (href) => {
      expect(isUncacheableRoute(href)).toBe(false);
    },
  );
});

describe('linkPrefetch', () => {
  it("keeps Next's default for public pages when nobody is signed in", () => {
    expect(linkPrefetch('/prizes')).toBeUndefined();
    expect(linkPrefetch('/', false)).toBeUndefined();
  });

  it('turns prefetch off for personal pages and redirects', () => {
    expect(linkPrefetch('/quizzes')).toBe(false);
    expect(linkPrefetch('/register')).toBe(false);
  });

  it('turns prefetch off for every page when someone may be signed in', () => {
    expect(linkPrefetch('/prizes', true)).toBe(false);
    expect(linkPrefetch('/quizzes', true)).toBe(false);
  });
});

// Guard: a new <Link href="/quizzes"> (or router.prefetch('/profile')) anywhere in src/ would send an
// uncacheable prefetch to Hostinger on every view of its page.
const ROOT = process.cwd();

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === 'tests' ? [] : filesUnder(path)) : [path];
  });
}

/** The route texts an href expression can produce: string literals and template heads, in every branch. */
function literalRoutes(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text];
  return node.getChildren().flatMap(literalRoutes);
}

function uncachedPrefetches(path: string, source = readFileSync(join(ROOT, path), 'utf8')): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const where = (node: ts.Node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;

  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Link') {
      const attr = (name: string) =>
        node.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(file) === name);
      const href = attr('href')?.initializer;
      const routes = href ? literalRoutes(href).filter(isUncacheableRoute) : [];
      if (routes.length && attr('prefetch')?.initializer?.getText(file) !== '{false}') {
        found.push(`${where(node)} <Link href=${href!.getText(file)}> needs prefetch={false}`);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'prefetch') {
      const [first] = node.arguments;
      if (first && literalRoutes(first).some(isUncacheableRoute)) found.push(`${where(node)} ${node.getText(file)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('no uncacheable prefetches in src/', () => {
  it('every <Link> to a personal page or redirect sets prefetch={false}, and nothing prefetches one by hand', () => {
    const offenders = filesUnder(join(ROOT, 'src'))
      .map((path) => relative(ROOT, path).split('\\').join('/'))
      .filter((path) => path.endsWith('.tsx') || path.endsWith('.ts'))
      .flatMap((path) => uncachedPrefetches(path));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['<Link href="/quizzes">Play</Link>', 1],
    ['<Link href={ok ? "/prizes" : "/register"} />', 1],
    ['<Link href={`/quiz/${id}/results`} prefetch={undefined} />', 1],
    ['router.prefetch(`/quiz/${id}`)', 1],
    ['<Link href="/quizzes" prefetch={false}>Play</Link>', 0],
    ['<Link href={`/quiz/${id}`} prefetch={false} />', 0],
    ['<Link href="/prizes" />', 0],
    ['<Link href={item.href} />', 0],
    ["router.prefetch('/leaderboard')", 0],
  ])('the guard flags %s %d time(s)', (code, count) => {
    expect(uncachedPrefetches('sample.tsx', `const x = () => ${code};`)).toHaveLength(count);
  });
});
